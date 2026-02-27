# ChronoTrack Updates: Today's Changes

**New Features & Enhancements**
* **Shift Scheduling System:** Added a robust shift scheduling capability along with an automatic clock-out feature.
* **Advanced Calendar Views:** Introduced Google Calendar-style **Week** and **Month** views for managing Shift Schedules.
* **Schedule Duplication:** Added a feature to duplicate daily schedules, including a toggle to instantly apply a day's schedule across the entire work week (Mon-Fri).
* **Interactive Shift Editing:** Implemented a new click-to-edit modal for quickly updating properties on schedule shift blocks.
* **UI Improvements:** Sorted users by assigned blocks in the daily planner for easier viewing and properly aligned the planner gridlines.

**Fixes & Refactoring**
* **Backend Migration:** Completely moved Shift Schedules storage from the Replit backend over to Firebase for better reliability and sync.
* **Deduplication Logic:** Fixed a bug to prevent identical shift blocks from being duplicated in Firebase, specifically when applying a schedule to an entire week.
* **Context-Aware Duplication:** Ensured that the schedule duplicator correctly respects the currently active tab—only duplicating Tasks when on the Tasks view, and Shifts when on the Shifts view.
* **User Management Sync:** Improved user deletion logic so that deleted users (e.g., clients) don't erroneously sync back into settings, and increased the scrollable height of the user settings list.
* **Z-Index Layering:** Fixed a visual bug where the duplicate schedule dropdown menu would improperly overlap with other UI elements.
