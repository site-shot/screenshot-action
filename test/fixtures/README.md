# Test fixtures

Every file here is synthetic: generated offline with ImageMagick 7.1.2-21 (`magick`) on 2026-10-24 and 2026-10-25, not captured from a web page or taken from Site-Shot. The tests derive their damaged variants from these files in memory and build the remaining PNG files themselves (`test/support/png.ts`); these files are the ones that another encoder wrote.

| File | Image | SHA-256 |
|---|---|---|
| `viewport-1024x768.png` | 1024x768 truecolor 8-bit, not interlaced, image data in three IDAT chunks | `dc9298f0e27b2e55c3029ac3bb9f2b1fa67105b3d7a2eb49fbffaf202c60e635` |
| `rgba-interlaced.png` | 13x7 truecolor with alpha 8-bit, Adam7 interlaced | `7b711a6143ab0f8b58e6e6f01cf2448bdc7629ab7047176aa89a7ea4b18df29f` |
| `gray16.png` | 5x3 grayscale 16-bit | `ebce01c3535ef3fa13db6ea123ba2f7474f61ab43319190717a02f2884c1adbd` |
| `palette.png` | 9x4 palette 2-bit, with PLTE | `101661b26bfa9409d3d2346ac4fdd2d7e98ce83a185621e8a4e5809be0981b86` |
| `photo.jpg` | 8x8 JPEG, the answer that is not a PNG | `1864c8b817043ed66a02a6fa3a9f73ba426b12cdb6ad01aa60047b91f2a0fefb` |

The commands:

```sh
magick -size 1024x768 xc: -channel R -fx "i/w" -channel G -fx "j/h" -channel B -fx "(sin(i/9)*cos(j/13)+1)/2" +channel \
  -fill "#0b5cad" -draw "rectangle 0,0 1023,79" -fill white -draw "rectangle 48,120 975,420" \
  -fill "#d0d7de" -draw "rectangle 48,460 500,720" -draw "rectangle 524,460 975,720" \
  -strip -define png:color-type=2 -define png:bit-depth=8 viewport-1024x768.png
magick -size 13x7 gradient:red-blue -alpha set -channel A -fx "0.25+0.5*i/w" +channel \
  -strip -interlace PNG -define png:color-type=6 -define png:bit-depth=8 rgba-interlaced.png
magick -size 5x3 gradient:black-white -colorspace Gray -strip -define png:color-type=0 -define png:bit-depth=16 gray16.png
magick -size 9x4 xc:red -fill blue -draw "point 1,1" -fill lime -draw "point 3,2" \
  -strip -define png:color-type=3 -define png:bit-depth=2 palette.png
magick -size 8x8 xc:yellow -strip photo.jpg
```

Another ImageMagick version may compress differently; the tests check dimensions and structure, not these hashes.
