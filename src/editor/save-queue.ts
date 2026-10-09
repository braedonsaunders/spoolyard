/** Serializes saves and drains edits made while a previous write was in flight. */
export class SaveQueue {
  content = "";
  saved = "";
  private inFlight: Promise<void> | null = null;

  constructor(public write: (content: string) => Promise<void>) {}

  get dirty() { return !!this.content && this.content !== this.saved; }
  get saving() { return this.inFlight !== null; }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!this.dirty) return Promise.resolve();
    this.inFlight = Promise.resolve().then(async () => {
      try {
        while (this.dirty) {
          const value = this.content;
          await this.write(value);
          this.saved = value;
        }
      } finally {
        this.inFlight = null;
      }
    });
    return this.inFlight;
  }
}
