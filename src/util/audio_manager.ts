import {WaveType} from '../nes/apu'
import {SoundChannel, PulseChannel, TriangleChannel, SawtoothChannel} from './audio/sound_channel'
import {createNoiseChannel} from './audio/noise_channel'
import {createDmcChannel} from './audio/delta_modulation_channel'

const GLOBAL_MASTER_VOLUME = 0.5

const DC_REMOVE_WORKER_PASS = 'assets/dc_remove_worker.js'

export class AudioManager {
  private static initialized = false
  private static audioContextClass?: AudioContext
  private static context?: AudioContext
  private static masterGainNode: GainNode
  private static analyserNode?: AnalyserNode
  private static masterVolume = 1.0

  private channels = new Array<SoundChannel>()

  public static setUp(audioContextClass: any): void {
    if (AudioManager.initialized)
      return

    if (audioContextClass == null)
      return
    AudioManager.audioContextClass = audioContextClass
    AudioManager.initialized = true
  }

  public static enableAudio(): void {
    if (AudioManager.context != null)
      return
    const audioContextClass: any = AudioManager.audioContextClass
    if (audioContextClass != null) {
      const context = new audioContextClass() as AudioContext
      AudioManager.context = context
      AudioManager.masterGainNode = context.createGain()
      AudioManager.masterGainNode.gain.setValueAtTime(
        AudioManager.masterVolume * GLOBAL_MASTER_VOLUME, context.currentTime)
      AudioManager.masterGainNode.connect(context.destination)
    }
  }

  public static setMasterVolume(volume: number): void {
    AudioManager.checkSetUpCalled()
    AudioManager.masterVolume = volume

    const context = AudioManager.context
    if (context)
      AudioManager.masterGainNode.gain.setValueAtTime(volume * GLOBAL_MASTER_VOLUME, context.currentTime)
  }

  public static createAnalyser(): AnalyserNode | null {
    const context = AudioManager.context
    if (context == null)
      return null
    if (AudioManager.analyserNode == null) {
      AudioManager.analyserNode = context.createAnalyser()
      AudioManager.createDcRemoveFilter(context)
          .then((node) => {
            AudioManager.masterGainNode.connect(node)
            node.connect(AudioManager.analyserNode!)
          })
          .catch(() => {
            AudioManager.masterGainNode.connect(AudioManager.analyserNode!)
          })
    }
    return AudioManager.analyserNode
  }

  private static async createDcRemoveFilter(context: AudioContext): Promise<AudioWorkletNode> {
    if (typeof(AudioWorkletNode) === 'undefined')
      return Promise.reject()
    await context.audioWorklet.addModule(DC_REMOVE_WORKER_PASS)
    return new AudioWorkletNode(context, 'dc_remove_worklet')
  }

  private static checkSetUpCalled(): void {
    if (!AudioManager.initialized) {
      console.error('Audio.setUp must be called!')
    }
  }

  constructor(private triggerDma: (adr: number) => number) {
    AudioManager.checkSetUpCalled()
  }

  public release(): void {
    this.releaseAllChannels()
  }

  public releaseAllChannels(): void {
    if (this.channels != null) {
      for (const channel of this.channels) {
        channel.destroy()
      }
      this.channels.length = 0
    }
  }

  public addChannel(type: WaveType): void {
    const context = AudioManager.context
    if (context == null)
      return

    let sc: SoundChannel

    const destination = AudioManager.masterGainNode
    switch (type) {
    case WaveType.PULSE:
      sc = new PulseChannel(context, destination)
      break
    case WaveType.TRIANGLE:
      sc = new TriangleChannel(context, destination)
      break
    case WaveType.NOISE:
      sc = createNoiseChannel(context, destination)
      break
    case WaveType.SAWTOOTH:
      sc = new SawtoothChannel(context, destination)
      break
    case WaveType.DMC:
      {
        const dmc = createDmcChannel(context, destination)
        dmc.setTriggerFunc(this.triggerDma)
        sc = dmc
      }
      break
    }

    sc.start()
    this.channels.push(sc)
  }

  public setChannelEnable(channel: number, enable: boolean): void {
    if (AudioManager.context == null)
      return
    this.channels[channel].setEnable(enable)
  }

  public setChannelFrequency(channel: number, frequency: number): void {
    if (AudioManager.context == null)
      return

    frequency = Math.min(frequency, AudioManager.context.sampleRate * 0.5)
    this.channels[channel].setFrequency(frequency)
  }

  public setChannelVolume(channel: number, volume: number): void {
    if (AudioManager.context == null)
      return
    this.channels[channel].setVolume(volume)
  }

  public setChannelDutyRatio(channel: number, dutyRatio: number): void {
    if (AudioManager.context == null)
      return
    this.channels[channel].setDutyRatio(dutyRatio)
  }

  public setChannelPeriod(channel: number, period: number, mode: number): void {
    if (AudioManager.context == null)
      return
    this.channels[channel].setNoisePeriod(period, mode)
  }

  public setChannelDmcWrite(channel: number, buf: ReadonlyArray<number>): void {
    if (AudioManager.context == null)
      return
    for (let i = 0; i < buf.length; ++i) {
      const d = buf[i]
      const r = d >> 8
      const v = d & 0xff
      this.channels[channel].setDmcWrite(r, v)
    }
  }

  public muteAll(): void {
    const n = this.channels.length
    for (let ch = 0; ch < n; ++ch)
      this.setChannelVolume(ch, 0)
  }
}
