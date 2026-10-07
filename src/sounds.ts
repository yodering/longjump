import { soundTiers, type Sound } from './sound-tiers';

export class Sounds {
  context?: AudioContext;
  private buffers = new Map<Sound, AudioBuffer>();
  private loading?: Promise<void>;
  private voice?: AudioBufferSourceNode;
  enabled = true;
  volume = 0.6;
  async unlock() {
    this.context ??= new AudioContext(); await this.context.resume();
    if (!this.loading) this.loading = this.load().catch(error => { this.loading = undefined; throw error; });
    await this.loading;
  }
  private async load() {
    const paths: [Sound, string][] = [...soundTiers.map(t => [t.name, `gokz/${t.name}.mp3`] as [Sound, string]), ['checkpoint', 'source/blip1.wav'], ['error', 'source/button10.wav']];
    const results = await Promise.allSettled(paths.map(async ([name, path]) => {
      const response = await fetch(`${import.meta.env.BASE_URL}audio/${path}`);
      if (!response.ok) throw new Error(`Sound ${name} failed to load`);
      this.buffers.set(name, await this.context!.decodeAudioData(await response.arrayBuffer()));
    }));
    const failed = results.find(r => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  play(name: Sound, preview = false) {
    if ((!this.enabled && !preview) || !this.context || this.context.state !== 'running') return;
    const buffer = this.buffers.get(name); if (!buffer) return;
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer; gain.gain.value = this.volume * (name === 'checkpoint' || name === 'error' ? 0.5 : 1);
    source.connect(gain); gain.connect(this.context.destination);
    if (name !== 'checkpoint' && name !== 'error') { this.voice?.stop(); this.voice = source; }
    source.onended = () => { if (this.voice === source) this.voice = undefined; source.disconnect(); gain.disconnect(); };
    source.start();
  }
}
