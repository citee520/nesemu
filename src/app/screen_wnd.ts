import WindowManager from '../wnd/window_manager'
import Wnd from '../wnd/wnd'
import {MenuItemInfo, WndEvent} from '../wnd/types'

import DomUtil from '../util/dom_util'
import Nes from '../nes/nes'
import {Scaler, NearestNeighborScaler, ScanlineScaler, EpxScaler} from '../util/scaler'

import App from './app'
import {AppEvent} from './app_event'
import AudioManager from '../util/audio_manager'
import PadKeyHandler from '../util/pad_key_handler'
import GamepadManager from '../util/gamepad_manager'

import * as Pubsub from '../util/pubsub'

const WIDTH = 256 | 0
const HEIGHT = 240 | 0
const HEDGE = 0 | 0
const VEDGE = 8 | 0

const TRANSITION_DURATION = '0.1s'

const TIME_SCALE_NORMAL = 1
const TIME_SCALE_FAST = 4

const enum ScalerType {
  NEAREST,
  SCANLINE,
  EPX,
}

let isAudioPermissionAcquired = false

function takeScreenshot(wndMgr: WindowManager, screenWnd: ScreenWnd): Wnd {
  const img = document.createElement('img') as HTMLImageElement
  const title = String(Date.now())
  img.src = screenWnd.capture()
  img.className = 'pixelated full-size'
  img.title = img.alt = title

  const imgWnd = new Wnd(wndMgr, WIDTH, HEIGHT, title)
  imgWnd.setContent(img)
  imgWnd.addResizeBox()
  wndMgr.add(imgWnd)
  return imgWnd
}

function fitAspectRatio(width: number, height: number, ratio: number): [number, number] {
  if (width / height >= ratio)
    width = height * ratio
  else
    height = width / ratio
  return [width, height]
}

export default class ScreenWnd extends Wnd {
  protected subscription: Pubsub.Subscription
  private fullscreenBase: HTMLElement
  private canvasHolder: HTMLElement
  private scaler: Scaler
  private hideEdge = true
  private contentWidth = 0  // Content size, except fullscreen
  private contentHeight = 0
  private menuItems: Array<MenuItemInfo>
  private scalerType = ScalerType.NEAREST
  private padKeyHandler = new PadKeyHandler()
  private timeScale = 1
  private fullscreenResizeFunc: () => void

  constructor(wndMgr: WindowManager, protected app: App, protected nes: Nes,
              protected stream: AppEvent.Stream)
  {
    super(wndMgr, (WIDTH - HEDGE * 2) * 2, (HEIGHT - VEDGE * 2) * 2 + Wnd.MENUBAR_HEIGHT, 'NES')
    if (app == null || nes == null || stream == null)
      return

    this.setUpMenuBar()
    this.contentHolder.style.overflow = 'hidden'

    this.fullscreenBase = document.createElement('div')
    this.fullscreenBase.className = 'full-size'
    DomUtil.setStyles(this.fullscreenBase, {
      position: 'relative',
      overflow: 'hidden',
    })
    this.setContent(this.fullscreenBase)

    this.canvasHolder = document.createElement('div')
    this.canvasHolder.style.transitionDuration = TRANSITION_DURATION
    this.fullscreenBase.appendChild(this.canvasHolder)

    this.setScaler(ScalerType.NEAREST)
    this.addResizeBox()

    this.subscription = this.stream
      .subscribe(type => {
        switch (type) {
        case AppEvent.Type.RENDER:
          this.render()
          break
        case AppEvent.Type.RESET:
          this.scaler.reset()
          break
        }
      })

    this.contentWidth = (WIDTH - HEDGE * 2) * 2
    this.contentHeight = (HEIGHT - VEDGE * 2) * 2
    this.updateContentSize(this.contentWidth, this.contentHeight)

    if (!isAudioPermissionAcquired) {
      const button = document.createElement('button')
      button.innerText = 'Enable audio'
      DomUtil.setStyles(button, {
        position: 'absolute',
        right: 0,
        top: 0,
      })
      button.addEventListener('click', _event => {
        AudioManager.enableAudio()
        this.app.setupAudioManager()
        button.parentNode!.removeChild(button)
        isAudioPermissionAcquired = true
        this.wndMgr.setFocus()
      })
      this.fullscreenBase.appendChild(button)
    }

    this.fullscreenResizeFunc = () => {
      const bounding = document.body.getBoundingClientRect()
      let width = bounding.width
      let height = bounding.height
      if (width / height >= WIDTH / HEIGHT) {
        width = (height * (WIDTH / HEIGHT)) | 0
      } else {
        height = (width * (HEIGHT / WIDTH)) | 0
      }
      DomUtil.setStyles(this.fullscreenBase, {
        width: `${width}px`,
        height: `${height}px`,
        margin: 'auto',
      })
      this.updateContentSize(width, height)
    }

    wndMgr.add(this)
  }

  public getTimeScale(): number {
    return this.timeScale
  }

  public onEvent(event: WndEvent, param?: any): any {
    switch (event) {
    case WndEvent.DRAG_BEGIN:
      this.stream.triggerPauseApp()
      break
    case WndEvent.DRAG_END:
      this.stream.triggerResumeApp()
      break
    case WndEvent.RESIZE_BEGIN:
      this.canvasHolder.style.transitionDuration = '0s'
      this.stream.triggerPauseApp()
      break
    case WndEvent.RESIZE_END:
      this.canvasHolder.style.transitionDuration = TRANSITION_DURATION
      this.stream.triggerResumeApp()
      break
    case WndEvent.RESIZE_MOVE:
      {
        const {width, height} = param
        this.onResized(width, height)
      }
      break
    case WndEvent.OPEN_MENU:
      this.stream.triggerPauseApp()
      break
    case WndEvent.CLOSE_MENU:
      this.stream.triggerResumeApp()
      break
    case WndEvent.UPDATE_FRAME:
      {
        this.padKeyHandler.update(this.wndMgr.getKeyboardManager())
        const speedUp = (this.isTop() &&
                         this.wndMgr.getKeyboardManager().getKeyPressing('ShiftLeft'))
        this.timeScale = speedUp ? TIME_SCALE_FAST : TIME_SCALE_NORMAL

        const elapsed: number = param
        this.stream.triggerStartCalc()
        this.stream.triggerUpdate(elapsed)
        this.stream.triggerEndCalc()
      }
      break
    case WndEvent.FOCUS:
      if (!param) {
        this.timeScale = TIME_SCALE_NORMAL
        this.padKeyHandler.clearAll()
      }
      break
    default:
      break
    }
  }

  public onResized(width: number, height: number): void {
    this.contentWidth = width
    this.contentHeight = height
    this.updateContentSize(width, height - Wnd.MENUBAR_HEIGHT)
  }

  public setClientSize(width: number, height: number): Wnd {
    width = Math.round(width)
    height = Math.round(height)
    super.setClientSize(width, height)
    this.contentWidth = width
    this.contentHeight = height
    this.updateContentSize(width, height)
    return this
  }

  public capture(): string {
    return this.scaler.getCanvas().toDataURL()
  }

  public getPadStatus(padNo: number): number {
    if (!this.isTop() || this.wndMgr.isBlur())
      return 0
    return this.padKeyHandler.getStatus(padNo) | GamepadManager.getState(padNo)
  }

  public setFullscreen(callback?: (isFullscreen: boolean) => boolean): boolean {
    window.addEventListener('resize', this.fullscreenResizeFunc)
    return this.wndMgr.setFullscreen(this.contentHolder, isFullscreen => {
      if (!isFullscreen) {
        window.removeEventListener('resize', this.fullscreenResizeFunc)
        DomUtil.setStyles(this.fullscreenBase, {
          width: '',
          height: '',
          margin: '',
        })
        DomUtil.setStyles(this.contentHolder, {
          backgroundColor: '',
          display: '',
        })
        this.updateContentSize(this.contentWidth, this.contentHeight)
      } else {
        DomUtil.setStyles(this.contentHolder, {
          backgroundColor: 'black',
          display: 'flex',  // To locate vertically middle.
        })
      }
      if (callback)
        callback(isFullscreen)
      this.contentHolder.focus()
    })
  }

  public close(): void {
    if (this.subscription != null)
      this.subscription.unsubscribe()
    this.stream.triggerCloseWnd(this)
    super.close()
  }

  public render(): void {
    this.scaler.render(this.nes)
  }

  protected setClientScale(scale: number): Wnd {
    const w = ((WIDTH - (this.hideEdge ? HEDGE * 2 : 0)) * scale) | 0
    const h = ((HEIGHT - (this.hideEdge ? VEDGE * 2 : 0)) * scale) | 0
    return this.setClientSize(w, h)
  }

  protected updateContentSize(width: number, height: number) {
    if (!this.fullscreenBase)
      return

    const w = !this.hideEdge ? width : (width * (WIDTH / (WIDTH - HEDGE * 2))) | 0
    const h = !this.hideEdge ? height : (height * (HEIGHT / (HEIGHT - VEDGE * 2))) | 0
    const left = !this.hideEdge ? 0 : -(w * HEDGE / WIDTH) | 0
    const top = !this.hideEdge ? 0 : -(h * VEDGE / HEIGHT) | 0
    DomUtil.setStyles(this.canvasHolder, {
      position: 'absolute',
      width: `${w}px`,
      height: `${h}px`,
      top: `${top}px`,
      left: `${left}px`,
    })
  }

  protected setUpMenuBar(): void {
    this.menuItems = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Pause',
            checked: () => this.nes.getCpu().isPaused(),
            click: () => {
              if (this.nes.getCpu().isPaused())
                this.stream.triggerRun()
              else
                this.stream.triggerPause()
            },
          },
          {
            label: 'Reset',
            click: () => {
              this.stream.triggerReset()
              this.stream.triggerRun()
            },
          },
          {
            label: 'Screenshot',
            click: () => {
              takeScreenshot(this.wndMgr, this)
            },
          },
          {label: '----'},
          {
            label: 'Save',
            click: () => this.app.saveData(),
          },
          {
            label: 'Load',
            disabled: () => !this.app.hasSaveData(),
            click: () => this.app.loadData(),
          },
          {label: '----'},
          {
            label: 'Quit',
            click: () => {
              this.close()
            },
          },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: '1x1',
            checked: () => this.isAspectRatio(1),
            click: () => {
              this.setClientScale(1)
            },
          },
          {
            label: '2x2',
            checked: () => this.isAspectRatio(2),
            click: () => {
              this.setClientScale(2)
            },
          },
          {
            label: 'Adjust aspect ratio',
            disabled: () => this.isAspectRatio(0),
            click: () => {
              this.adjustAspectRatio()
            },
          },
          {label: '----'},
          {
            label: 'Fullscreen',
            click: () => {
              this.setFullscreen()
            },
          },
        ],
      },
      {
        label: 'Scaler',
        submenu: [
          {
            label: 'Nearest',
            checked: () => this.scalerType === ScalerType.NEAREST,
            click: () => {
              this.setScaler(ScalerType.NEAREST)
            },
          },
          {
            label: 'Scanline',
            checked: () => this.scalerType === ScalerType.SCANLINE,
            click: () => {
              this.setScaler(ScalerType.SCANLINE)
            },
          },
          {
            label: 'Epx',
            checked: () => this.scalerType === ScalerType.EPX,
            click: () => {
              this.setScaler(ScalerType.EPX)
            },
          },
        ],
      },
      {
        label: 'Debug',
        submenu: [
          {
            label: 'Edge',
            checked: () => !this.hideEdge,
            click: () => {
              this.toggleEdge()
            },
          },
          {
            label: 'Sprite flicker',
            checked: () => !this.nes.getPpu().suppressSpriteFlicker,
            click: () => {
              this.toggleSpriteFlicker()
            },
          },
          {label: '----'},
          {
            label: 'Palette',
            click: () => {
              this.app.createPaletWnd()
            },
          },
          {
            label: 'NameTable',
            click: () => {
              this.app.createNameTableWnd()
            },
          },
          {
            label: 'PatternTable',
            click: () => {
              this.app.createPatternTableWnd()
            },
          },
          {
            label: 'Audio',
            click: () => {
              this.app.createAudioWnd()
            },
          },
          {
            label: 'FPS',
            click: () => {
              this.app.createFpsWnd()
            },
          },
          {label: '----'},
          {
            label: 'Trace',
            click: () => {
              this.app.createTraceWnd()
            },
          },
          {
            label: 'Registers',
            click: () => {
              this.app.createRegisterWnd()
            },
          },
          {
            label: 'Control',
            click: () => {
              this.app.createControlWnd()
            },
          },
        ],
      },
    ]
    this.addMenuBar(this.menuItems)
  }

  protected maximize() {
    const rootRect = this.wndMgr.getRootClientRect()
    const winWidth = rootRect.width
    const winHeight = rootRect.height
    const maxWidth = winWidth - 2  // -2 for border size
    const maxHeight = winHeight - Wnd.TITLEBAR_HEIGHT - Wnd.MENUBAR_HEIGHT - 2

    const w = Math.round(WIDTH - (this.hideEdge ? HEDGE * 2 : 0))
    const h = Math.round(HEIGHT - (this.hideEdge ? VEDGE * 2 : 0))
    const [width, height] = fitAspectRatio(maxWidth, maxHeight, w / h)

    const x = (winWidth - (width + 2)) / 2
    const y = (winHeight - (height + Wnd.TITLEBAR_HEIGHT + Wnd.MENUBAR_HEIGHT + 2)) / 2
    this.setPos(Math.round(x), Math.round(y))
    this.setClientSize(width, height)
  }

  private isAspectRatio(scale: number): boolean {
    const rect = this.contentHolder.getBoundingClientRect()
    const w = WIDTH - (this.hideEdge ? HEDGE * 2 : 0)
    const h = HEIGHT - (this.hideEdge ? VEDGE * 2 : 0)

    if (scale > 0)
      return Math.abs(rect.width - w * scale) < 0.5 && Math.abs(rect.height - h * scale) < 0.5
    return Math.abs(rect.width / rect.height - w / h) < 0.005
  }

  private adjustAspectRatio() {
    const rect = this.contentHolder.getBoundingClientRect()
    const w = WIDTH - (this.hideEdge ? HEDGE * 2 : 0)
    const h = HEIGHT - (this.hideEdge ? VEDGE * 2 : 0)
    const [width, height] = fitAspectRatio(rect.width, rect.height, w / h)
    this.setClientSize(width, height)
  }

  private toggleEdge() {
    this.hideEdge = !this.hideEdge
    this.updateContentSize(this.contentHolder.offsetWidth, this.contentHolder.offsetHeight)
  }

  private toggleSpriteFlicker() {
    const ppu = this.nes.getPpu()
    ppu.suppressSpriteFlicker = !ppu.suppressSpriteFlicker
  }

  private setScaler(type: ScalerType): void {
    const initial = this.scaler == null
    if (this.scalerType === type && !initial)
      return
    this.scalerType = type
    switch (type) {
    case ScalerType.NEAREST:
      this.scaler = new NearestNeighborScaler()
      break
    case ScalerType.SCANLINE:
      this.scaler = new ScanlineScaler()
      break
    case ScalerType.EPX:
      this.scaler = new EpxScaler()
      break
    }
    DomUtil.removeAllChildren(this.canvasHolder)
    this.canvasHolder.appendChild(this.scaler.getCanvas())

    if (!initial)
      this.render()
  }
}
