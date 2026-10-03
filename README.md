# AIN Paper Builder

Private website for AIN mentors: a shared NEET question bank, personalised question papers for each mentee with spaced repetition, print-ready papers with answer keys and solutions, and OMR-style marking.

- Live site: https://pk-knch-1.github.io/ain-paper-builder/
- Data, logins and access rules live in the Supabase project `ain-paper-builder`. This repository holds only the website files; no questions, mentees or passwords are stored here.
- `js/config.js` contains the project's public (anon) key, which is meant to be public. What each person can see is enforced by the database's row-level security.

Plain HTML, CSS and JavaScript with no build step. KaTeX is bundled in `vendor/katex` for maths and chemistry.
