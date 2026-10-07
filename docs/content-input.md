# 内容输入与公共素材

活动内容的唯一可编辑源是负责人指定的 XLSX 及其引用的同目录公共素材。生成配置、网页、Word、海报、社媒稿和飞书业务表都是派生产物或业务记录，不能另做内容源。复制 `input/fictional-conference.xlsx` 的表名和表头，或用 `scripts/create_sample.py input/new-event` 建副本；清除全部虚构示例事实，更新 `event.slug`。

只有原始 PDF/Word 时先逐页提取全文并查看实际页面。录入完整简介、机构/角色、须知、食宿、交通、联系人、资料和地图。日程逐日逐行保留 date/time/title/speaker/chair/location，完整保存主持人单位职务及跨页记录；Group 字段只表达原资料相邻且内容一致的共享单元格。sourceNotes 保存来源文件与实际/印刷页码及未给事实，它只进入私有配置和内部核验。

日期按资料精度保留：仅知日期使用 startDate/endDate，未知 startAt/endAt、容量、窗口、资格留空。不能填午夜/日末、1970年、容量1或任意开放窗口。未知日程时刻/地点保留“时间待通知”“地点待通知”。场馆写 event.location，完整街道地址写 travel.address。要正式开放相关提交前必须问负责人确认真实容量与对应窗口。

## 固定正文引用

只支持八个字面引用：`{{event.title}}`、`{{event.shortTitle}}`、`{{event.dateRange}}`、`{{event.location}}`、`{{travel.address}}`、`{{organizers.主办单位}}`、`{{organizers.协办单位}}`、`{{organizers.支持单位}}`。规范字段录入一次，例如简介写“{{event.title}}将于{{event.dateRange}}在{{event.location}}举办。”。机构按同角色原顺序连接。

只用于配置契约允许的公共文字字段，不放URL、素材路径、日期、规范事实或Group ID；不支持表达式/任意路径。未知、未闭合、空事实引用失败。生成器一次展开后由HTML/SVG/XML层转义。修改规范字段并重生成即可更新所有引用。

## 横幅

同活动且获授权的 heroImage 才可复用原字节。先实际查看，核对名称、日期、场地和品牌，再运行：

```sh
.venv/bin/python scripts/bind_hero.py input/new-event/event.xlsx --confirm-current-facts
```

脚本只写图片旁 `.facts.json` 的图像/规范事实哈希，不改图片、不造第二份事实。绑定缺失或事实失配时自动生成当前SVG；原因只在manifest和终端，公开页面不显示诊断。确认同图依然准确后可显式重绑定，否则换正确图片。相邻绑定随素材/追溯快照保存。

无现成横幅时使用最多五个brandmarks、seriesText/bannerTitle构成可编辑框架，无brandmarks可用branding.logo，两者都空不造品牌名；现成heroImage不叠加新标识。清除旧活动品牌和日期。新背景的来源及许可见PROVENANCE.md。
