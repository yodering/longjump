type KeyboardCapture = { lock: (keys: string[]) => Promise<void>; unlock: () => void };

// Regular tabs reserve close shortcuts. Fullscreen can capture W; otherwise
// beforeunload asks for confirmation during play instead of silently closing.
export class PlayGuard {
  private playing = false;
  private fullscreen = false;
  constructor(private target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
    private keyboard?: KeyboardCapture) {}
  private confirmLeave = (event: BeforeUnloadEvent) => {
    event.preventDefault(); event.returnValue = true;
  };
  setPlaying(playing: boolean, fullscreen: boolean) {
    this.playing = playing;
    this.target.removeEventListener('beforeunload', this.confirmLeave);
    if (playing) this.target.addEventListener('beforeunload', this.confirmLeave);
    void this.capture(fullscreen);
  }
  async capture(fullscreen: boolean) {
    this.fullscreen = fullscreen;
    if (!this.keyboard) return;
    if (!this.playing || !fullscreen) { this.keyboard.unlock(); return; }
    try {
      await this.keyboard.lock(['KeyW']);
      if (!this.fullscreen || !this.playing) this.keyboard.unlock();
    } catch { /* Close confirmation still protects unsupported/denied browsers. */ }
  }
}
