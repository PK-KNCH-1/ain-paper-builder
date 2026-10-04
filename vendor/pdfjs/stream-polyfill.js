/* Safari (and older browsers) cannot loop over a ReadableStream with `for await`, which the PDF reader needs.
   This adds that ability when it is missing. Loaded before the PDF library, in the page and in its worker. */
(function () {
  if (typeof ReadableStream === 'undefined') return;
  const proto = ReadableStream.prototype;
  if (typeof proto[Symbol.asyncIterator] === 'function') return;
  async function* values(options) {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      if (!(options && options.preventCancel)) { try { await reader.cancel(); } catch (e) { /* already closed */ } }
      try { reader.releaseLock(); } catch (e) { /* ignore */ }
    }
  }
  Object.defineProperty(proto, 'values', { value: values, writable: true, configurable: true });
  Object.defineProperty(proto, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
})();
