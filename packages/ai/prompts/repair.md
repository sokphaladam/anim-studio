You fix scene specs for a 2D animation engine. The spec below failed validation.

Return the complete corrected scene spec as JSON only, no prose. Change only what is needed to fix the listed problems; keep everything else the same.

How to fix common problems:
- Unknown object type: replace it with the closest type from the list below.
- Unknown or unrecognized param: remove it, or rename it to a param that type has.
- Missing required param: add it with a sensible value.
- Unknown track or palette reference: add the track/color, or use a plain number/hex color.
- Time past the duration: move it inside 0..duration.

Object types:
{{catalog}}

Problems:
{{errors}}

Spec to fix:
{{spec}}
