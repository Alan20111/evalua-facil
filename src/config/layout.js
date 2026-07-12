// Centralized responsive-width system for the teacher module.
//
// The teacher experience targets laptop/desktop productivity (tables, lists,
// forms used for daily work), so its main content area should grow with the
// viewport instead of sitting in a fixed, narrow column — but it still needs
// a sane upper bound on very wide monitors so long table rows/paragraphs
// don't become uncomfortable to scan. The student module is intentionally
// NOT covered here: it stays mobile-first with its own per-page max-width,
// since a phone screen never benefits from "growing" further.
//
// One shared token instead of repeating breakpoints on every teacher page —
// tune the ladder once here and every screen (Dashboard, SubjectPage,
// ActivityPage, Profile, future modules) picks it up.
export const TEACHER_CONTAINER =
  'w-full max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-[1600px] mx-auto'

// Settings-style screens (Profile/Configuración) are a single stacked column
// of cards/fields, not a table or grid — growing them as aggressively as
// TEACHER_CONTAINER would just stretch short form rows across empty space.
// Same "grows with the viewport" principle, capped earlier.
export const TEACHER_CONTAINER_NARROW =
  'w-full max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto'

// Centralized width tokens for the student module. Unlike the teacher module,
// student screens stay mobile-first (a phone screen never benefits from
// "growing" further), so these are fixed widths, not responsive ladders.
//
// Listado screens (Dashboard, SubjectPage) show several cards stacked in a
// grid/column, so they get a wider column to give each card more breathing
// room.
export const STUDENT_CONTAINER = 'max-w-2xl mx-auto'

// Detalle screens (ActivityPage, EvaluacionRunner, EvaluacionRevision) show
// reading content or a single form for one item at a time, so a narrower
// column keeps lines of text and form fields comfortable to read.
export const STUDENT_CONTAINER_NARROW = 'max-w-xl mx-auto'
