# Design QA

## Comparison target

- Source visual truth: `/home/excel/.codex/generated_images/01a1a0c0-ddd4-7430-b284-8b5a6eb3bbca/exec-d97ee2b2-9b9c-4fc3-b262-c239bd70bc90.png`
- Implementation: browser-rendered `http://localhost:3003/` at the desktop course-library state.
- Viewport: Chrome desktop browser (capture tooling reported the live app state, but did not expose a durable local screenshot path).
- State: signed-in course library.

## Findings

- [P1] Catalogue data did not populate in the temporary verification server.
  Location: course-grid.
  Evidence: the browser showed the intended navigation, heading, search, filters, and empty-catalogue state, while the local SQLite database contains 6,071 courses.
  Impact: the grid and course-detail state could not be verified with live course content in this preview session.
  Fix: start the application's normal development server with its existing data/runtime, then recheck the populated catalogue and a course-detail flow.

## Required fidelity surfaces

- Fonts and typography: IBM Plex Sans is loaded as the global UI face; the rendered signed-in study screen reflected the new font.
- Spacing and layout rhythm: verified on the rendered course-library empty state; the catalogue has a separated, spacious heading and control area.
- Colors and visual tokens: verified the muted green active navigation and quiet neutral background; no thumbnails are rendered.
- Image quality and asset fidelity: no new image assets are used in the course catalogue, by design.
- Copy and content: catalogue labels, search, filters, and course/lecture language match the approved direction.

## Implementation checklist

1. Run the usual local server on port 3002 and confirm the catalogue endpoint returns course rows.
2. Verify a populated card grid, then open a course and select a playable lecture.

## Comparison history

- Initial pass: build completed successfully; browser validation reached the signed-in course-library interface but its transient server returned zero catalogue entries.

final result: blocked
