//! In-memory countdown for one native-messaging connection.
//!
//! A pending power action lives only inside this process. Disconnect, cancellation,
//! or a failed acknowledgement drops it. Nothing is written to disk, and nothing is
//! relaunched after this process exits.

use crate::os_adapter::{
    executed_message, executing_message, failed_message, PermissionRequester, PowerAction,
    PowerController,
};
use crate::protocol::{
    failure, permission_response, success, HostResponse, Intake, ScheduledAction,
};
use serde_json::json;
use std::time::Duration;
use tokio::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingAction {
    action_id: String,
    request_id: String,
    action: PowerAction,
    deadline: Instant,
    countdown_seconds: u64,
}

/// Checked-out power action that has not run yet. Dropping it does not touch the OS.
#[must_use = "dropping a prepared execution cancels it without running a power action"]
#[derive(Debug)]
pub struct PreparedExecution {
    action_id: String,
    request_id: String,
    action: PowerAction,
    deadline: Instant,
    countdown_seconds: u64,
}

/// One browser connection. At most one real power action can be pending.
pub struct HostSession<C, P> {
    controller: C,
    permission: P,
    pending: Option<PendingAction>,
    connected: bool,
}

impl<C, P> HostSession<C, P>
where
    C: PowerController,
    P: PermissionRequester,
{
    pub fn new(controller: C, permission: P) -> Self {
        Self {
            controller,
            permission,
            pending: None,
            connected: true,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected
    }

    pub fn deadline(&self) -> Option<Instant> {
        self.pending.as_ref().map(|pending| pending.deadline)
    }

    /// Browser input closed, or the extension port is gone. The pending action is discarded.
    pub fn on_disconnect(&mut self) {
        self.connected = false;
        self.pending = None;
    }

    pub fn handle_message(&mut self, raw: &str) -> HostResponse {
        if !self.connected {
            return failure("", "connection_lost", "The helper connection is closed.");
        }
        match crate::protocol::interpret(raw) {
            Intake::Respond(response) => response,
            Intake::RequestPermission { request_id } => {
                let outcome = self.permission.request_permission();
                permission_response(&request_id, outcome)
            }
            Intake::Schedule(schedule) => self.schedule(schedule),
            Intake::Cancel {
                request_id,
                action_id,
            } => self.cancel(&request_id, &action_id),
        }
    }

    fn schedule(&mut self, schedule: ScheduledAction) -> HostResponse {
        if let Some(pending) = &self.pending {
            return success(
                &schedule.request_id,
                json!({
                    "status": "coalesced",
                    "actionId": pending.action_id,
                    "action": pending.action.as_str(),
                    "executionMode": "real",
                    "countdownSeconds": pending.countdown_seconds,
                }),
            );
        }

        let pending = PendingAction {
            action_id: schedule.action_id.clone(),
            request_id: schedule.request_id.clone(),
            action: schedule.action,
            deadline: Instant::now() + Duration::from_secs(schedule.countdown_seconds),
            countdown_seconds: schedule.countdown_seconds,
        };
        let response = scheduled_response(&pending);
        self.pending = Some(pending);
        response
    }

    fn cancel(&mut self, request_id: &str, action_id: &str) -> HostResponse {
        let matches = self
            .pending
            .as_ref()
            .is_some_and(|pending| pending.action_id == action_id);
        if !matches {
            return failure(
                request_id,
                "unknown_action_id",
                "There is no pending action with that id.",
            );
        }
        let pending = self
            .pending
            .take()
            .expect("pending action was just checked");
        success(
            request_id,
            json!({
                "status": "cancelled",
                "actionId": pending.action_id,
                "action": pending.action.as_str(),
                "executionMode": "real",
                "countdownSeconds": pending.countdown_seconds,
            }),
        )
    }

    /// Take the pending action once the deadline has passed and the port is still open.
    pub fn begin_execution(&mut self) -> Option<PreparedExecution> {
        if !self.connected {
            self.pending = None;
            return None;
        }
        let pending = self.pending.as_ref()?;
        if Instant::now() < pending.deadline {
            return None;
        }
        let pending = self.pending.take()?;
        Some(PreparedExecution {
            action_id: pending.action_id,
            request_id: pending.request_id,
            action: pending.action,
            deadline: pending.deadline,
            countdown_seconds: pending.countdown_seconds,
        })
    }

    pub fn executing_notice(prepared: &PreparedExecution) -> HostResponse {
        success(
            &prepared.request_id,
            json!({
                "status": "executing",
                "actionId": prepared.action_id,
                "action": prepared.action.as_str(),
                "executionMode": "real",
                "countdownSeconds": prepared.countdown_seconds,
                "executed": false,
                "message": executing_message(prepared.action),
            }),
        )
    }

    /// Drop a checked-out action without calling the operating system.
    pub fn abort_execution(&mut self, prepared: PreparedExecution) {
        drop(prepared);
    }

    /// Invoke the pending action exactly once. A failed call is not repeated.
    pub fn commit_execution(&mut self, prepared: PreparedExecution) -> HostResponse {
        if !self.connected || Instant::now() < prepared.deadline || prepared.action_id.is_empty() {
            return failure(
                &prepared.request_id,
                "connection_lost",
                "The pending action was discarded before it ran.",
            );
        }

        let action = prepared.action;
        match self.controller.execute(action) {
            Ok(()) => success(
                &prepared.request_id,
                json!({
                    "status": "executed",
                    "actionId": prepared.action_id,
                    "action": action.as_str(),
                    "executionMode": "real",
                    "countdownSeconds": prepared.countdown_seconds,
                    "executed": true,
                    "message": executed_message(action),
                }),
            ),
            Err(_) => success(
                &prepared.request_id,
                json!({
                    "status": "failed",
                    "actionId": prepared.action_id,
                    "action": action.as_str(),
                    "executionMode": "real",
                    "countdownSeconds": prepared.countdown_seconds,
                    "executed": false,
                    "message": failed_message(action),
                }),
            ),
        }
    }
}

fn scheduled_response(pending: &PendingAction) -> HostResponse {
    success(
        &pending.request_id,
        json!({
            "status": "scheduled",
            "actionId": pending.action_id,
            "action": pending.action.as_str(),
            "executionMode": "real",
            "countdownSeconds": pending.countdown_seconds,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::HostSession;
    use crate::os_adapter::{
        FakePermissionRequester, FakePowerController, PermissionOutcome, PowerAction,
    };
    use serde_json::json;
    use std::time::Duration;

    fn session(
        controller: FakePowerController,
        outcome: PermissionOutcome,
    ) -> HostSession<FakePowerController, FakePermissionRequester> {
        HostSession::new(controller, FakePermissionRequester { outcome })
    }

    fn schedule_message(action_id: &str, action: &str, countdown: u64) -> String {
        serde_json::to_string(&json!({
            "protocolVersion": 2,
            "requestId": "req-schedule",
            "type": "schedule_action",
            "actionId": action_id,
            "action": action,
            "executionMode": "real",
            "countdownSeconds": countdown,
            "context": { "downloadId": 7, "filename": "example.zip" }
        }))
        .unwrap()
    }

    fn cancel_message(action_id: &str) -> String {
        serde_json::to_string(&json!({
            "protocolVersion": 2,
            "requestId": "req-cancel",
            "type": "cancel_action",
            "actionId": action_id
        }))
        .unwrap()
    }

    fn permission_message() -> String {
        serde_json::to_string(&json!({
            "protocolVersion": 2,
            "requestId": "req-permission",
            "type": "request_permission"
        }))
        .unwrap()
    }

    #[tokio::test(start_paused = true)]
    async fn each_real_action_runs_once_after_the_deadline() {
        for (name, expected) in [
            ("sleep", PowerAction::Sleep),
            ("shutdown", PowerAction::Shutdown),
            ("reboot", PowerAction::Reboot),
        ] {
            let controller = FakePowerController::succeeding();
            let mut host = session(controller.clone(), PermissionOutcome::Granted);
            let response = host.handle_message(&schedule_message("act-1", name, 10));
            let result = response.result.unwrap();
            assert_eq!(result["status"], "scheduled");
            assert_eq!(result["action"], name);
            assert_eq!(controller.calls(), 0);

            tokio::time::advance(Duration::from_secs(9)).await;
            assert!(host.begin_execution().is_none());

            tokio::time::advance(Duration::from_secs(1)).await;
            let prepared = host.begin_execution().expect(name);
            let notice =
                HostSession::<FakePowerController, FakePermissionRequester>::executing_notice(
                    &prepared,
                );
            assert_eq!(notice.result.unwrap()["action"], name);
            let finished = host.commit_execution(prepared);
            let result = finished.result.unwrap();
            assert_eq!(result["status"], "executed");
            assert_eq!(result["action"], name);
            assert_eq!(controller.actions(), vec![expected]);

            tokio::time::advance(Duration::from_secs(30)).await;
            assert!(host.begin_execution().is_none());
            assert_eq!(controller.calls(), 1);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn cancellation_before_the_deadline_does_not_run() {
        for name in ["sleep", "shutdown", "reboot"] {
            let controller = FakePowerController::succeeding();
            let mut host = session(controller.clone(), PermissionOutcome::Granted);
            host.handle_message(&schedule_message("act-1", name, 10));
            let cancelled = host.handle_message(&cancel_message("act-1"));
            let result = cancelled.result.unwrap();
            assert_eq!(result["status"], "cancelled");
            assert_eq!(result["action"], name);

            tokio::time::advance(Duration::from_secs(10)).await;
            assert!(host.begin_execution().is_none());
            assert_eq!(controller.calls(), 0);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn disconnect_before_the_deadline_does_not_run() {
        for name in ["sleep", "shutdown", "reboot"] {
            let controller = FakePowerController::succeeding();
            let mut host = session(controller.clone(), PermissionOutcome::Granted);
            host.handle_message(&schedule_message("act-1", name, 10));
            host.on_disconnect();

            tokio::time::advance(Duration::from_secs(10)).await;
            assert!(host.begin_execution().is_none());
            assert_eq!(controller.calls(), 0);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn aborting_after_the_deadline_does_not_run() {
        let controller = FakePowerController::succeeding();
        let mut host = session(controller.clone(), PermissionOutcome::Granted);
        host.handle_message(&schedule_message("act-1", "reboot", 10));
        tokio::time::advance(Duration::from_secs(10)).await;
        let prepared = host.begin_execution().unwrap();
        host.abort_execution(prepared);
        assert_eq!(controller.calls(), 0);
        assert!(host.begin_execution().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn a_second_schedule_keeps_the_original_action_and_deadline() {
        let controller = FakePowerController::succeeding();
        let mut host = session(controller.clone(), PermissionOutcome::Granted);
        host.handle_message(&schedule_message("act-1", "shutdown", 10));
        let deadline = host.deadline();
        let second = host.handle_message(&schedule_message("act-2", "reboot", 30));
        let result = second.result.unwrap();
        assert_eq!(result["status"], "coalesced");
        assert_eq!(result["actionId"], "act-1");
        assert_eq!(result["action"], "shutdown");
        assert_eq!(result["countdownSeconds"], 10);
        assert_eq!(host.deadline(), deadline);

        tokio::time::advance(Duration::from_secs(10)).await;
        let prepared = host.begin_execution().unwrap();
        assert_eq!(prepared.action_id, "act-1");
        assert_eq!(prepared.action, PowerAction::Shutdown);
        host.commit_execution(prepared);
        assert_eq!(controller.actions(), vec![PowerAction::Shutdown]);

        tokio::time::advance(Duration::from_secs(30)).await;
        assert!(host.begin_execution().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_action_is_not_retried() {
        let controller = FakePowerController::failing();
        let mut host = session(controller.clone(), PermissionOutcome::Denied);
        host.handle_message(&schedule_message("act-1", "reboot", 10));
        tokio::time::advance(Duration::from_secs(10)).await;
        let prepared = host.begin_execution().unwrap();
        let finished = host.commit_execution(prepared);
        let result = finished.result.unwrap();
        assert_eq!(result["status"], "failed");
        assert_eq!(result["action"], "reboot");
        assert_eq!(result["message"], "The computer did not restart.");
        assert_eq!(controller.actions(), vec![PowerAction::Reboot]);

        tokio::time::advance(Duration::from_secs(60)).await;
        assert!(host.begin_execution().is_none());
        assert_eq!(controller.calls(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn cancelling_a_different_id_leaves_the_pending_action() {
        let controller = FakePowerController::succeeding();
        let mut host = session(controller.clone(), PermissionOutcome::Granted);
        host.handle_message(&schedule_message("act-1", "shutdown", 10));
        let response = host.handle_message(&cancel_message("act-2"));
        assert_eq!(response.error.unwrap().code, "unknown_action_id");
        tokio::time::advance(Duration::from_secs(10)).await;
        let prepared = host.begin_execution().unwrap();
        assert_eq!(prepared.action, PowerAction::Shutdown);
        host.abort_execution(prepared);
        assert_eq!(controller.calls(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn committing_after_disconnect_does_not_run() {
        let controller = FakePowerController::succeeding();
        let mut host = session(controller.clone(), PermissionOutcome::Granted);
        host.handle_message(&schedule_message("act-1", "sleep", 10));
        tokio::time::advance(Duration::from_secs(10)).await;
        let prepared = host.begin_execution().unwrap();
        host.on_disconnect();
        let finished = host.commit_execution(prepared);
        assert_eq!(finished.error.unwrap().code, "connection_lost");
        assert_eq!(controller.calls(), 0);
    }

    #[test]
    fn permission_results_map_without_claiming_success_on_failure() {
        let granted = session(
            FakePowerController::succeeding(),
            PermissionOutcome::Granted,
        )
        .handle_message(&permission_message());
        assert_eq!(granted.result.unwrap()["permission"], "granted");

        let denied = session(FakePowerController::succeeding(), PermissionOutcome::Denied)
            .handle_message(&permission_message());
        assert_eq!(denied.error.unwrap().code, "permission_denied");
        assert!(denied.result.is_none());

        let unavailable = session(
            FakePowerController::succeeding(),
            PermissionOutcome::Unavailable,
        )
        .handle_message(&permission_message());
        assert_eq!(unavailable.error.unwrap().code, "permission_unavailable");
    }
}
