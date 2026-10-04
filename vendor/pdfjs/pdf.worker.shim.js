// Worker entry: add missing stream features first, then start the PDF library's worker.
import './stream-polyfill.js';
import './pdf.worker.min.js';
