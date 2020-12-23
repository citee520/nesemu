export default class DomUtil {
  public static clearCanvas(canvas: HTMLCanvasElement): void {
    const context = canvas.getContext('2d')
    if (context == null)
      return
    context.strokeStyle = ''
    context.fillStyle = `rgb(64,64,64)`
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  public static removeAllChildren(element: HTMLElement): void {
    for (const child of element.childNodes)
      element.removeChild(child)
  }

  public static setStyles(elem: HTMLElement, styles: Record<string, unknown>): void {
    Object.assign(elem.style, styles)
  }

  public static loadFile(file: File): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = function(e) {
        const target = e.target as FileReader
        if (target.result)
          resolve(new Uint8Array(target.result as ArrayBuffer))
        else
          reject()
      }
      reader.onerror = function(_e) {
        reject(reader.error)
      }
      reader.readAsArrayBuffer(file)
    })
  }

  public static handleFileDrop(dropZone: HTMLElement,
                               onDropped: (files: FileList, x: number, y: number) => void): void
  {
    function onDrop(event: DragEvent) {
      if (event.dataTransfer) {
        event.stopPropagation()
        event.preventDefault()
        const files = event.dataTransfer.files
        if (files.length > 0) {
          onDropped(files, event.pageX, event.pageY)
        }
      }
      return false
    }

    function onDragOver(event: DragEvent) {
      if (event.dataTransfer) {
        event.stopPropagation()
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }
      return false
    }

    dropZone.addEventListener('dragover', onDragOver, false)
    dropZone.addEventListener('drop', onDrop, false)
  }

  public static getCanvasContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = canvas.getContext('2d')
    if (context == null)
      throw new Error('2d context not supported or canvas already initialized')
    return context
  }

  public static timeout(millisec: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, millisec))
  }

  public static download(blob: Blob, filename: string): void {
    const objectURL = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectURL
    a.setAttribute('download', filename)
    a.click()
  }

  // Register mouse drag event listener.
  public static setMouseDragListener(mouseMove: any, mouseUp?: any, useCapture?: boolean): void {
    let mouseLeave: ((event: MouseEvent) => void) | null = null
    let mouseLeaveTarget: HTMLElement | null = null
    if (typeof mouseMove === 'object') {
      const option = mouseMove
      mouseMove = option.move
      mouseUp = option.up
      mouseLeave = option.leave
      useCapture = option.useCapture

      mouseLeaveTarget = mouseLeave == null ? null : option.leaveTarget || document
    }

    const unlisten = () => {
      document.removeEventListener('mousemove', mouseMove, useCapture)
      document.removeEventListener('mouseup', mouseUpDelegate, useCapture)
      if (mouseLeaveDelegate && mouseLeaveTarget)
        mouseLeaveTarget.removeEventListener('mouseleave', mouseLeaveDelegate, useCapture)
    }

    const mouseUpDelegate = ($event: MouseEvent) => {
      if (mouseUp)
        mouseUp($event)
      unlisten()
    }

    const mouseLeaveDelegate = (mouseLeave == null ? null : ($event: MouseEvent) => {
      if (mouseLeave && mouseLeave($event))
        unlisten()
    })

    document.addEventListener('mousemove', mouseMove, useCapture)
    document.addEventListener('mouseup', mouseUpDelegate, useCapture)
    if (mouseLeaveDelegate && mouseLeaveTarget)
      mouseLeaveTarget.addEventListener('mouseleave', mouseLeaveDelegate, useCapture)
  }

  public static getMousePosIn(event: MouseEvent, elem: HTMLElement): [number, number] {
    const rect = elem.getBoundingClientRect()
    const scrollLeft = document.body.scrollLeft
    const scrollTop = document.body.scrollTop
    return [event.pageX - rect.left - scrollLeft,
            event.pageY - rect.top - scrollTop]
  }
}
