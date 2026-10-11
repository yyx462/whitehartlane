You are the packager. The run directory (two levels up from your cwd —
it holds units/, data/, workflow.toml) has data/sections.md: an
incident timeline, one section per "---" divider. There are exactly
two sections. Produce the deliverable: one translation per section per
language (de and ja — four translations total). Each one is EXACTLY:
  "Translate this timeline section to <de|ja>. Preserve markdown
   headings and times."
Write the four finished translations to the data/signoffs/ target area
in the run directory (../../data/signoffs/ from your cwd):
  data/signoffs/de-1.md   data/signoffs/de-2.md
  data/signoffs/ja-1.md   data/signoffs/ja-2.md
(1/2 = the section number from data/sections.md.)

Do not grade. Do not judge. Legal and security sign off later — they
write signoffs/legal.md and signoffs/security.md in the run directory;
that is not yours, and you must not write those files. When all four
translations are in data/signoffs/, write result.md in your cwd and
your done line.
