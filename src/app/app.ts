import Nes from '../nes/nes'
import {MirrorMode} from '../nes/ppu/types'

import {AppEvent} from './app_event'
import AudioManager from '../util/audio_manager'
import Fds from '../nes/fds/fds'
import {FdsCtrlWnd} from './fds_ctrl_wnd'
import {RegisterWnd, TraceWnd, ControlWnd} from './debug_wnd'
import {FpsWnd, PaletWnd, NameTableWnd, PatternTableWnd, AudioWnd} from './other_wnd'
import ScreenWnd from './screen_wnd'
import StorageUtil from '../util/storage_util'
import Util from '../util/util'
import WindowManager from '../wnd/window_manager'
import Wnd from '../wnd/wnd'

import * as Pubsub from '../util/pubsub'

const MAX_ELAPSED_TIME = 1000 / 15

export class Option {
  public title?: string
  public centerX?: number
  public centerY?: number
  public onClosed?: (app: App) => void
}

export const enum AppWndType {
  SCREEN = 1,
  PALET,
  NAME,
  PATTERN,
  AUDIO,
  REGISTER,
  TRACE,
  CONTROL,
  FPS,
}

export default class App {
  protected destroying = false
  protected isPaused = false
  protected nes: Nes
  protected audioManager: AudioManager
  protected stream = new AppEvent.Stream()
  protected subscription: Pubsub.Subscription

  protected title: string
  protected screenWnd: ScreenWnd
  protected wndMap = new Array<Wnd | null>()

  protected fds?: Fds

  public static create(wndMgr: WindowManager, option: Option): App {
    return new App(wndMgr, option)
  }

  constructor(protected wndMgr: WindowManager, protected option: Option, noDefault?: boolean) {
    if (noDefault)
      return

    this.nes = Nes.create()
    window.app = this  // Put app into global.
    this.nes.setVblankCallback(leftV => this.onVblank(leftV))
    this.nes.setBreakPointCallback(() => this.onBreakPoint())

    this.subscription = this.stream
      .subscribe((type, param?) => this.handleAppEvent(type, param))

    const screenWnd = new ScreenWnd(this.wndMgr, this, this.nes, this.stream)
    this.wndMap[AppWndType.SCREEN] = this.screenWnd = screenWnd
    this.title = (option.title as string) || 'NES'
    this.screenWnd.setTitle(this.title)

    const size = this.screenWnd.getWindowSize()
    let x = Util.clamp((option.centerX || 0) - size.width / 2,
                       0, window.innerWidth - size.width - 1)
    let y = Util.clamp((option.centerY || 0) - size.height / 2,
                       0, window.innerHeight - size.height - 1)
    this.screenWnd.setPos(x, y)
  }

  public loadRom(romData: Uint8Array): boolean | string {
    const result = this.nes.setRomData(romData)
    if (result !== true)
      return result

    this.setupAudioManager()

    this.nes.reset()
    this.nes.getCpu().pause(false)
    this.screenWnd.getContentHolder().focus()

    if (window.$DEBUG) {  // Accessing global variable!!!
      this.createPaletWnd()
      this.createNameTableWnd()
      this.createPatternTableWnd()
      this.createTraceWnd()
      this.createRegisterWnd()
      this.createControlWnd()
    }

    return true
  }

  public bootDiskBios(biosData: Uint8Array): boolean {
    this.fds = new Fds(biosData, this.nes)

    this.setupAudioManager()

    this.nes.reset()
    this.nes.getCpu().pause(false)
    this.screenWnd.getContentHolder().focus()

    return true
  }

  public setDiskImage(diskData: Uint8Array): boolean {
    if (this.fds == null)
      return false
    const result = this.fds.setImage(diskData)
    if (result) {
      /*const ctrlWnd =*/ new FdsCtrlWnd(this.wndMgr, this.fds)
      this.wndMgr.moveToTop(this.screenWnd)
    }
    return result
  }

  public close(): void {
    this.screenWnd.close()
  }

  public saveData(): boolean {
    const saveData = this.nes.save()
    return StorageUtil.putObject(this.title, saveData)
  }

  public hasSaveData(): boolean {
    return StorageUtil.hasKey(this.title)
  }

  public loadData(): any {
    const saveData = StorageUtil.getObject(this.title, null)
    if (saveData) {
      try {
        this.nes.load(saveData)
      } catch (e) {
        console.error(e)
        this.wndMgr.showSnackbar('Error: Load data failed')
        this.nes.reset()
      }
    } else {
      this.wndMgr.showSnackbar(`No save data for "${this.title}"`)
    }
  }

  public createPaletWnd(): boolean {
    if (this.wndMap[AppWndType.PALET] != null)
      return false
    const paletWnd = new PaletWnd(this.wndMgr, this.nes, this.stream)
    paletWnd.setPos(520, 0)
    this.wndMap[AppWndType.PALET] = paletWnd
    return true
  }

  public createNameTableWnd(): boolean {
    if (this.wndMap[AppWndType.NAME] != null)
      return false

    const ppu = this.nes.getPpu()
    const nameTableWnd = new NameTableWnd(this.wndMgr, ppu, this.stream,
                                          ppu.getMirrorMode() === MirrorMode.HORZ)
    nameTableWnd.setPos(520, 40)
    this.wndMap[AppWndType.NAME] = nameTableWnd
    return true
  }

  public createPatternTableWnd(): boolean {
    if (this.wndMap[AppWndType.PATTERN] != null)
      return false

    const getSelectedPalets = (buf: Uint8Array): boolean => {
      const paletWnd = this.wndMap[AppWndType.PALET] as PaletWnd
      if (paletWnd == null)
        return false
      paletWnd.getSelectedPalets(buf)
      return true
    }
    const patternTableWnd = new PatternTableWnd(this.wndMgr, this.nes.getPpu(), this.stream,
                                                getSelectedPalets)
    patternTableWnd.setPos(520, 300)
    this.wndMap[AppWndType.PATTERN] = patternTableWnd
    return true
  }

  public createAudioWnd(): boolean {
    if (this.wndMap[AppWndType.AUDIO] != null)
      return false
    const wnd = new AudioWnd(this.wndMgr, this.nes, this.stream)
    this.wndMap[AppWndType.AUDIO] = wnd
    return true
  }

  public createTraceWnd(): boolean {
    if (this.wndMap[AppWndType.TRACE] != null)
      return false
    const traceWnd = new TraceWnd(this.wndMgr, this.nes, this.stream)
    traceWnd.setPos(0, 500)
    this.wndMap[AppWndType.TRACE] = traceWnd
    return true
  }

  public createRegisterWnd(): boolean {
    if (this.wndMap[AppWndType.REGISTER] != null)
      return false
    const registerWnd = new RegisterWnd(this.wndMgr, this.nes, this.stream)
    registerWnd.setPos(410, 500)
    this.wndMap[AppWndType.REGISTER] = registerWnd
    return true
  }

  public createControlWnd(): boolean {
    if (this.wndMap[AppWndType.CONTROL] != null)
      return false
    const ctrlWnd = new ControlWnd(this.wndMgr, this.stream)
    ctrlWnd.setPos(520, 500)
    this.wndMap[AppWndType.CONTROL] = ctrlWnd
    return true
  }

  public createFpsWnd(): boolean {
    if (this.wndMap[AppWndType.FPS] != null)
      return false
    const fpsWnd = new FpsWnd(this.wndMgr, this.stream)
    this.wndMap[AppWndType.FPS] = fpsWnd
    return true
  }

  public setupAudioManager() {
    if (this.audioManager == null) {
      this.audioManager = new AudioManager()
    } else {
      this.audioManager.releaseAllChannels()
    }

    const channelTypes = this.nes.getSoundChannelTypes()
    for (const type of channelTypes) {
      this.audioManager.addChannel(type)
    }
  }

  protected destroy() {
    for (let wnd of Object.values(this.wndMap))
      if (wnd != null)
        wnd.close()

    this.cleanUp()
    if (this.option.onClosed)
      this.option.onClosed(this)
  }

  protected cleanUp() {
    this.destroying = true
    if (this.audioManager)
      this.audioManager.release()

    this.subscription.unsubscribe()
  }

  protected handleAppEvent(type: AppEvent.Type, param?: any) {
    switch (type) {
    case AppEvent.Type.UPDATE:
      if (!this.isPaused) {
        const elapsed: number = param
        this.update(elapsed)
      }
      break
    case AppEvent.Type.RUN:
      this.nes.getCpu().pause(false)
      break
    case AppEvent.Type.PAUSE:
      this.nes.getCpu().pause(true)
      this.muteAudio()
      break
    case AppEvent.Type.STEP:
      this.nes.step(0)
      break
    case AppEvent.Type.RESET:
      this.nes.reset()
      break
    case AppEvent.Type.PAUSE_APP:
      this.isPaused = true
      this.muteAudio()
      break
    case AppEvent.Type.RESUME_APP:
      this.isPaused = false
      break
    case AppEvent.Type.CLOSE_WND:
      {
        const wnd = param as Wnd
        const i = this.wndMap.indexOf(wnd)
        if (i >= 0) {
          this.wndMap[i] = null
          if (i === AppWndType.SCREEN)
            this.destroy()
          break
        }
      }
      break
    default:
      break
    }
  }

  protected onVblank(leftV: number): void {
    if (leftV < 1)
      this.render()
    this.updateAudio()
  }

  protected onBreakPoint(): void {
    this.stream.triggerBreakPoint()
  }

  protected update(elapsedTime: number): void {
    if (this.nes.getCpu().isPaused())
      return

    for (let i = 0; i < 2; ++i) {
      const pad = this.screenWnd.getPadStatus(i)
      this.nes.setPadStatus(i, pad)
    }

    const et = Math.min(elapsedTime, MAX_ELAPSED_TIME) * this.screenWnd.getTimeScale()

    this.nes.runMilliseconds(et)
  }

  protected render(): void {
    this.stream.triggerRender()
  }

  protected updateAudio(): void {
    const audioManager = this.audioManager
    const count = audioManager.getChannelCount()
    for (let ch = 0; ch < count; ++ch) {
      const volume = this.nes.getSoundVolume(ch)
      audioManager.setChannelVolume(ch, volume)
      if (volume > 0) {
        audioManager.setChannelFrequency(ch, this.nes.getSoundFrequency(ch))
        audioManager.setChannelDutyRatio(ch, this.nes.getSoundDutyRatio(ch))
      }
    }
  }

  protected muteAudio(): void {
    const n = this.audioManager.getChannelCount()
    for (let ch = 0; ch < n; ++ch)
      this.audioManager.setChannelVolume(ch, 0)
  }
}
