import { toast } from './events'

/** 목업 resizeImg(): 이미지를 600×800 안으로 줄여 JPEG data URL로 돌려줍니다. 업로드하지 않습니다. */
export function resizeImg(file: File | undefined, cb: (url: string) => void) {
  if (!file || !/^image\//.test(file.type)) return toast('이미지 파일을 골라 주세요')
  const r = new FileReader()
  r.onload = () => {
    const im = new Image()
    im.onload = () => {
      const k = Math.min(1, 600 / im.width, 800 / im.height)
      const c = document.createElement('canvas')
      c.width = Math.round(im.width * k)
      c.height = Math.round(im.height * k)
      c.getContext('2d')?.drawImage(im, 0, 0, c.width, c.height)
      cb(c.toDataURL('image/jpeg', 0.86))
    }
    im.onerror = () => toast('이미지를 읽지 못했어요')
    im.src = String(r.result)
  }
  r.readAsDataURL(file)
}
