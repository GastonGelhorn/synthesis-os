use crate::commands::applescript;
use crate::commands::traits::*;

/// macOS implementation of AppBridge — all via AppleScript.
pub struct MacOSApps;

/// Escape a string for AppleScript double-quoted strings.
fn escape_as(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\n")
        .replace('\t', "\\t")
}

impl AppBridge for MacOSApps {
    // ── Notes ───────────────────────────────────────────────────────

    async fn notes_list(&self, query: Option<&str>) -> Result<Vec<NoteItem>, String> {
        let filter = match query {
            Some(q) => format!(
                r#"set foundNotes to (notes whose name contains "{q}" or body contains "{q}")"#,
                q = escape_as(q)
            ),
            None => "set foundNotes to notes".to_string(),
        };

        let script = format!(
            r#"
tell application "Notes"
    set noteList to {{}}
    {filter}
    set recentNotes to items 1 through (min(count of foundNotes, 10)) of foundNotes
    repeat with n in recentNotes
        set noteTitle to name of n
        set modDate to modification date of n
        set end of noteList to noteTitle & "|||" & (modDate as string)
    end repeat
    set AppleScript's text item delimiters to "%%%"
    return noteList as string
end tell

on min(x, y)
    if x < y then return x
    else return y
end min"#
        );

        let stdout = applescript::run(&script).await?;
        let notes = stdout
            .trim()
            .split("%%%")
            .filter(|s| !s.is_empty())
            .map(|line| {
                let parts: Vec<&str> = line.splitn(2, "|||").collect();
                NoteItem {
                    title: parts.first().unwrap_or(&"").to_string(),
                    date: parts.get(1).unwrap_or(&"").to_string(),
                }
            })
            .collect();
        Ok(notes)
    }

    async fn notes_read(&self, title: &str) -> Result<String, String> {
        let script = format!(
            r#"
tell application "Notes"
    set targetNote to first note whose name is "{}"
    return (body of targetNote) as string
end tell"#,
            escape_as(title)
        );

        applescript::run(&script).await
    }

    async fn notes_create(&self, title: &str, body: &str) -> Result<(), String> {
        let script = format!(
            r#"
tell application "Notes"
    make new note with properties {{name:"{}", body:"{}"}}
end tell"#,
            escape_as(title),
            escape_as(body)
        );

        applescript::run(&script).await?;
        Ok(())
    }

    // ── Email ───────────────────────────────────────────────────────

    async fn email_list(
        &self,
        mailbox: &str,
        max: u32,
        unread_only: bool,
    ) -> Result<Vec<EmailMessage>, String> {
        let max = max.min(25);
        let unread_filter_start = if unread_only {
            "if msgRead is false then"
        } else {
            ""
        };
        let unread_filter_end = if unread_only { "end if" } else { "" };

        let script = format!(
            r#"
tell application "Mail"
    set msgList to {{}}
    set targetMailbox to inbox
    repeat with acct in accounts
        try
            set targetMailbox to mailbox "{mailbox}" of acct
            exit repeat
        end try
    end repeat

    set msgCount to count of messages of targetMailbox
    set fetchCount to {max}
    if fetchCount > msgCount then set fetchCount to msgCount

    repeat with i from 1 to fetchCount
        set msg to message i of targetMailbox
        set msgSubject to subject of msg
        set msgSender to sender of msg
        set msgDate to date received of msg
        set msgRead to read status of msg
        {unread_filter_start}
        set msgExcerpt to ""
        try
            set msgExcerpt to (text 1 thru 150 of (content of msg))
        on error
            try
                set msgExcerpt to content of msg
            end try
        end try
        set end of msgList to msgSubject & "|||" & msgSender & "|||" & (msgDate as string) & "|||" & msgRead & "|||" & msgExcerpt
        {unread_filter_end}
    end repeat

    set AppleScript's text item delimiters to "\n"
    return msgList as string
end tell"#,
            mailbox = escape_as(mailbox)
        );

        let stdout = applescript::run(&script).await?;
        let messages = stdout
            .trim()
            .lines()
            .filter(|s| !s.is_empty())
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(5, "|||").collect();
                if parts.len() >= 4 {
                    Some(EmailMessage {
                        subject: parts[0].trim().to_string(),
                        from: parts[1].trim().to_string(),
                        date: parts[2].trim().to_string(),
                        read: parts[3].trim() == "true",
                        preview: parts.get(4).unwrap_or(&"").trim().to_string(),
                    })
                } else {
                    None
                }
            })
            .collect();
        Ok(messages)
    }

    // ── Calendar ────────────────────────────────────────────────────

    async fn calendar_today(&self) -> Result<Vec<CalendarEvent>, String> {
        let script = r#"
tell application "Calendar"
    set today to current date
    set todayStart to today - (time of today)
    set todayEnd to todayStart + (1 * days)

    set eventList to {}
    repeat with cal in calendars
        set todayEvents to (every event of cal whose start date >= todayStart and start date < todayEnd)
        repeat with evt in todayEvents
            set evtTitle to summary of evt
            set evtStart to start date of evt
            set evtEnd to end date of evt
            set evtLoc to ""
            try
                set evtLoc to location of evt
            end try
            set evtNotes to ""
            try
                set evtNotes to description of evt
            end try
            set end of eventList to evtTitle & "|||" & (evtStart as string) & "|||" & (evtEnd as string) & "|||" & evtLoc & "|||" & evtNotes
        end repeat
    end repeat

    set AppleScript's text item delimiters to "%%%"
    return eventList as string
end tell"#;

        let stdout = applescript::run(script).await?;
        let events = stdout
            .trim()
            .split("%%%")
            .filter(|s| !s.is_empty())
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(5, "|||").collect();
                if parts.len() >= 3 {
                    Some(CalendarEvent {
                        title: parts[0].trim().to_string(),
                        start_date: parts[1].trim().to_string(),
                        end_date: parts[2].trim().to_string(),
                        location: parts.get(3).unwrap_or(&"").trim().to_string(),
                        notes: parts.get(4).unwrap_or(&"").trim().to_string(),
                    })
                } else {
                    None
                }
            })
            .collect();
        Ok(events)
    }

    async fn calendar_create(
        &self,
        title: &str,
        start: &str,
        end: &str,
        notes: Option<&str>,
    ) -> Result<(), String> {
        let notes_prop = match notes {
            Some(n) => format!(r#", description:"{}""#, escape_as(n)),
            None => String::new(),
        };
        let script = format!(
            r#"
tell application "Calendar"
    tell calendar 1
        make new event with properties {{summary:"{}", start date:date "{}", end date:date "{}"{} }}
    end tell
end tell"#,
            escape_as(title),
            escape_as(start),
            escape_as(end),
            notes_prop
        );

        applescript::run(&script).await?;
        Ok(())
    }

    // ── Reminders ───────────────────────────────────────────────────

    async fn reminders_list(&self) -> Result<Vec<ReminderItem>, String> {
        let script = r#"
tell application "Reminders"
    set reminderList to {}
    repeat with r in (reminders of default list whose completed is false)
        set rName to name of r
        set rDue to ""
        try
            set rDue to due date of r as string
        end try
        set end of reminderList to rName & "|||" & rDue
    end repeat
    set AppleScript's text item delimiters to "%%%"
    return reminderList as string
end tell"#;

        let stdout = applescript::run(script).await?;
        let reminders = stdout
            .trim()
            .split("%%%")
            .filter(|s| !s.is_empty())
            .map(|line| {
                let parts: Vec<&str> = line.splitn(2, "|||").collect();
                ReminderItem {
                    name: parts.first().unwrap_or(&"").to_string(),
                    due_date: parts.get(1).unwrap_or(&"").to_string(),
                    completed: false,
                }
            })
            .collect();
        Ok(reminders)
    }

    async fn reminders_add(&self, title: &str, due: Option<&str>) -> Result<(), String> {
        let due_prop = match due {
            Some(d) => format!(r#", due date:date "{}""#, escape_as(d)),
            None => String::new(),
        };
        let script = format!(
            r#"
tell application "Reminders"
    tell default list
        make new reminder with properties {{name:"{}"{} }}
    end tell
end tell"#,
            escape_as(title),
            due_prop
        );

        applescript::run(&script).await?;
        Ok(())
    }

    // ── Contacts ────────────────────────────────────────────────────

    async fn contacts_search(&self, query: &str) -> Result<Vec<ContactInfo>, String> {
        let script = format!(
            r#"
tell application "Contacts"
    set contactList to {{}}
    set foundPeople to (every person whose name contains "{}")
    set fetchCount to count of foundPeople
    if fetchCount > 10 then set fetchCount to 10
    
    if fetchCount > 0 then
        repeat with i from 1 to fetchCount
            set p to item i of foundPeople
            set pName to name of p
            set pEmail to ""
            try
                set pEmail to value of first email of p
            end try
            set pPhone to ""
            try
                set pPhone to value of first phone of p
            end try
            set end of contactList to pName & "|||" & pEmail & "|||" & pPhone
        end repeat
    end if
    set AppleScript's text item delimiters to "%%%"
    return contactList as string
end tell"#,
            escape_as(query)
        );

        let stdout = applescript::run(&script).await?;
        let contacts = stdout
            .trim()
            .split("%%%")
            .filter(|s| !s.is_empty())
            .map(|line| {
                let parts: Vec<&str> = line.splitn(3, "|||").collect();
                ContactInfo {
                    name: parts.first().unwrap_or(&"").to_string(),
                    email: parts.get(1).unwrap_or(&"").to_string(),
                    phone: parts.get(2).unwrap_or(&"").to_string(),
                }
            })
            .collect();
        Ok(contacts)
    }

    // ── Music ───────────────────────────────────────────────────────

    async fn music_play(&self, query: Option<&str>) -> Result<String, String> {
        let script = match query {
            Some(q) => format!(
                r#"
tell application "Music"
    set searchResults to search playlist "Library" for "{}"
    if (count of searchResults) > 0 then
        play item 1 of searchResults
        return name of current track & " - " & artist of current track
    else
        return "No results found"
    end if
end tell"#,
                escape_as(q)
            ),
            None => r#"
tell application "Music"
    play
    return name of current track & " - " & artist of current track
end tell"#
                .to_string(),
        };
        applescript::run(&script).await
    }

    async fn music_pause(&self) -> Result<(), String> {
        applescript::run(r#"tell application "Music" to pause"#).await?;
        Ok(())
    }

    async fn music_next(&self) -> Result<(), String> {
        applescript::run(r#"tell application "Music" to next track"#).await?;
        Ok(())
    }

    // ── Finder ──────────────────────────────────────────────────────

    async fn finder_open(&self, path: &str) -> Result<(), String> {
        tokio::process::Command::new("open")
            .arg(path)
            .output()
            .await
            .map_err(|e| format!("Failed to open {}: {}", path, e))?;
        Ok(())
    }

    async fn finder_trash(&self, path: &str) -> Result<(), String> {
        let script = format!(
            r#"tell application "Finder" to delete POSIX file "{}""#,
            escape_as(path)
        );
        applescript::run(&script).await?;
        Ok(())
    }

    // ── Safari ──────────────────────────────────────────────────────

    async fn safari_tabs(&self) -> Result<Vec<String>, String> {
        let script = r#"
tell application "Safari"
    set tabList to {}
    repeat with w in windows
        repeat with t in tabs of w
            set end of tabList to (name of t) & " | " & (URL of t)
        end repeat
    end repeat
    set AppleScript's text item delimiters to "%%%"
    return tabList as string
end tell"#;

        let stdout = applescript::run(script).await?;
        Ok(stdout
            .trim()
            .split("%%%")
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect())
    }
}
