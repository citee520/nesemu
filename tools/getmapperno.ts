import fs from 'node:fs/promises'
import path from 'path'
import JSZip from 'jszip'

import {Cartridge} from '../src/nes/cartridge'

function getMapperNo(romData: Uint8Array): number {
  if (!Cartridge.isRomValid(romData)) {
    console.error('Invalid format')
    process.exit(1)
  }
  const cartridge = new Cartridge(romData)
  return cartridge.mapperNo
}

async function dumpMapper(fn: string): Promise<void> {
  switch (path.extname(fn).toLowerCase()) {
  case '.nes':
    const buffer = await fs.readFile(fn) as Buffer
    console.log(`"${path.basename(fn)}"\tmapper=${getMapperNo(buffer)}`)
    return
  case '.zip':
    {
      const buffer = await fs.readFile(fn)
      const zip = new JSZip()
      const loadedZip = await zip.loadAsync(buffer)
      for (let fileName of Object.keys(loadedZip.files)) {
        if (path.extname(fileName).toLowerCase() === '.nes') {
          const unzipped = await loadedZip.files[fileName].async('uint8array')
          console.log(`"${path.basename(fn)}"\tmapper=${getMapperNo(unzipped)}`)
          return
        }
      }
    }
    console.error(`${fn}: .nes not included`)
    break
  default:
    console.error(`${fn}: Unsupported extname`)
    break
  }
  process.exit(1)
}

async function main(): Promise<void> {
  const argv = process.argv
  if (argv.length < 3) {
    console.error('Please specify .nes or .zip file(s).')
    process.exit(1)
  }

  await Promise.all(argv.slice(2).map(arg => dumpMapper(arg)))
}

main()
