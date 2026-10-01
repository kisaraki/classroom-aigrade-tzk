# 報表中文字型

PDF 使用 Noto Sans TC，來源為 [Google Fonts](https://github.com/google/fonts/blob/main/ofl/notosanstc/METADATA.pb)，授權完整保留於 [OFL.txt](OFL.txt)。檔案只在伺服器 PDF 路由載入，不包含學生資料；不在執行報表時發出外部字型請求。

2026-10-01 從官方 `ofl/notosanstc/NotoSansTC[wght].ttf` 取得來源，以 fontTools 4.66.1 固定 weight=400、保留全部 Unicode cmap、移除 hinting／layout features，產生 `NotoSansTC-Regular.ttf`（6,906,456 bytes）。不需要 Python 或 fontTools 作為應用程式 runtime dependency。

- 來源 SHA-256：`864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`
- 產出 SHA-256：`df0d9b70d55a565a1bbd73a3e198ce184c23a6414d1a4b341797a87946452a5a`

可重建步驟（先驗證上述來源 hash）：

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

font = TTFont("NotoSansTC-variable.ttf")
instantiateVariableFont(font, {"wght": 400}, inplace=True)
options = subset.Options()
options.hinting = False
options.layout_features = []
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=font.getBestCmap().keys())
subsetter.subset(font)
font.save("NotoSansTC-Regular.ttf")
```

PDF 明確提供 Unicode 與 glyph 映射；字型無法呈現的字元會拒絕匯出，避免靜默漏字。字型嵌入增加 Worker bundle 與每份 PDF 大小，正式平台仍須驗證資源限制。
