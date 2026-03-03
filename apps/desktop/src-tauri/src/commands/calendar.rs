use block2::RcBlock;
use objc2::runtime::Bool;
use objc2::{msg_send, sel};
use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStore};
use objc2_foundation::NSDate;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Debug)]
pub struct CalendarEvent {
    pub title: String,
    pub start_timestamp: f64,
    pub end_timestamp: f64,
    pub location: Option<String>,
    pub calendar: String,
}

#[tauri::command]
pub fn get_calendar_events(
    start_offset_days: f64,
    end_offset_days: f64,
) -> Result<Vec<CalendarEvent>, String> {
    let store = unsafe { EKEventStore::new() };

    let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };

    if status == EKAuthorizationStatus::FullAccess {
        // Already authorized
    } else if status == EKAuthorizationStatus::NotDetermined {
        let (tx, rx) = std::sync::mpsc::channel();
        let tx_opt = Arc::new(Mutex::new(Some(tx)));

        let block = RcBlock::new(
            move |granted: Bool, _error: *mut objc2_foundation::NSError| {
                if let Some(tx) = tx_opt.lock().unwrap().take() {
                    let _ = tx.send(granted.as_bool());
                }
            },
        );

        unsafe {
            let responds: bool = msg_send![&store, respondsToSelector: sel!(requestFullAccessToEventsWithCompletion:)];
            if responds {
                store.requestFullAccessToEventsWithCompletion(&*block as *const _ as *mut _);
            } else {
                #[allow(deprecated)]
                store.requestAccessToEntityType_completion(
                    EKEntityType::Event,
                    &*block as *const _ as *mut _,
                );
            }
        }

        let granted = rx.recv().unwrap_or(false);
        if !granted {
            return Err("Calendar access denied by user or macOS (Prompt Rejected). Check System Settings -> Privacy & Security -> Calendars.".to_string());
        }
    } else {
        return Err(format!("Calendar access denied (Status: {}). During 'npm run dev', you must grant Calendar access to your Terminal / IDE (e.g. VS Code, iTerm). Overwise, build the app using 'npm run build:tauri'.", status.0));
    }

    // Access granted, fetch events
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs_f64();
    let start_ts = now + (start_offset_days * 24.0 * 60.0 * 60.0);
    let end_ts = now + (end_offset_days * 24.0 * 60.0 * 60.0);

    let ns_start = NSDate::dateWithTimeIntervalSince1970(start_ts);
    let ns_end = NSDate::dateWithTimeIntervalSince1970(end_ts);

    let predicate = unsafe {
        store.predicateForEventsWithStartDate_endDate_calendars(&ns_start, &ns_end, None)
    };
    let events = unsafe { store.eventsMatchingPredicate(&predicate) };

    let mut result_events = Vec::new();
    for i in 0..events.count() {
        let event = events.objectAtIndex(i);

        let title = unsafe { event.title() }.to_string();

        // NSDate interval since 1970
        let start_ts = unsafe { event.startDate().timeIntervalSince1970() };
        let end_ts = unsafe { event.endDate().timeIntervalSince1970() };

        let location = unsafe { event.location() }.map(|l| l.to_string());

        let calendar_name = unsafe { event.calendar() }
            .map_or("".to_string(), |c| unsafe { c.title() }.to_string());

        result_events.push(CalendarEvent {
            title,
            start_timestamp: start_ts,
            end_timestamp: end_ts,
            location,
            calendar: calendar_name,
        });
    }

    Ok(result_events)
}
