# Element Plus 2.14.5 API 目录审计

来源：[官方精确发布源码](https://github.com/element-plus/element-plus/tree/ba62d6397a2fd27c757ef472831be2c8a35afe2d)（MIT）、版本仓库的总览 sidebar 和 docs/en-US/component，以及已安装的公开声明。数据只保存类型、默认值、事件/槽/方法等事实，不复制示例正文。

官方82条目与生成目录采用集合比较：missing=0、extra=0。文档 API 行逐项比较：missing=0。目录含 129 个 API 组，1941 Props、320 Events、253 Slots、267 Exposes；数量仅摘要，不能抵消缺项。

生成：

```sh
node scripts/generate-element-catalog.ts /path/to/element-plus-2.14.5
```

复杂值保留 function/component/vnode/date/element/regexp 等类型，配置与行为验收由 V2 引用系统负责；目录生成通过不等于所有运行时行为已验收。内部 ref/对象 API 标 parentApiKey/propPath，不伪造公开组件。

| 条目               | 性质      | API组                                                                            | Props | Events | Slots | Exposes |
| ------------------ | --------- | -------------------------------------------------------------------------------- | ----: | -----: | ----: | ------: |
| button             | component | button, button-group                                                             |    22 |      1 |     4 |       5 |
| border             | design    | border                                                                           |    17 |      0 |     0 |       0 |
| color              | design    | color                                                                            |    77 |      0 |     0 |       0 |
| container          | component | container, header, aside, main, footer                                           |     4 |      0 |     5 |       0 |
| icon               | component | icon                                                                             |     2 |      0 |     1 |       0 |
| layout             | composite | row, col                                                                         |    14 |      0 |     2 |       0 |
| link               | component | link                                                                             |     6 |      1 |     2 |       0 |
| text               | component | text                                                                             |     5 |      0 |     1 |       0 |
| scrollbar          | component | scrollbar                                                                        |    17 |      2 |     1 |       6 |
| space              | component | space                                                                            |    10 |      0 |     1 |       0 |
| splitter           | component | splitter, splitter-panel                                                         |     7 |      7 |     3 |       1 |
| typography         | design    | typography                                                                       |     9 |      0 |     0 |       0 |
| config-provider    | component | config-provider                                                                  |    15 |      0 |     1 |       0 |
| autocomplete       | component | autocomplete                                                                     |    54 |      7 |     8 |      13 |
| cascader           | component | cascader, cascader-panel                                                         |    46 |     15 |     9 |       9 |
| checkbox           | component | checkbox, checkbox-group, checkbox-button                                        |    49 |      6 |     3 |       0 |
| color-picker-panel | component | color-picker-panel                                                               |     9 |      1 |     1 |       3 |
| color-picker       | component | color-picker                                                                     |    19 |      7 |     0 |       5 |
| date-picker-panel  | component | date-picker-panel                                                                |    25 |      5 |     5 |       0 |
| date-picker        | component | date-picker                                                                      |    48 |      8 |     6 |       4 |
| datetime-picker    | component | date-picker                                                                      |    48 |      8 |     6 |       4 |
| form               | component | form, form-item                                                                  |    28 |      1 |     4 |      15 |
| input              | component | input                                                                            |    37 |     12 |     5 |      12 |
| input-number       | component | input-number                                                                     |    24 |      5 |     4 |       2 |
| input-tag          | component | input-tag                                                                        |    26 |      9 |     3 |       2 |
| input-otp          | component | input-otp                                                                        |    13 |      5 |     1 |       3 |
| mention            | component | mention                                                                          |    51 |      8 |     5 |       3 |
| radio              | component | radio, radio-group, radio-button                                                 |    26 |      4 |     3 |       0 |
| rate               | component | rate                                                                             |    22 |      2 |     0 |       2 |
| select             | component | select, option-group, option                                                     |    59 |      9 |    10 |       3 |
| select-v2          | component | select-v2                                                                        |    57 |      8 |     8 |       3 |
| slider             | component | slider                                                                           |    26 |      3 |     0 |       0 |
| switch             | component | switch                                                                           |    24 |      3 |     4 |       2 |
| time-picker        | component | time-picker                                                                      |    49 |      6 |     0 |       4 |
| time-select        | component | time-select                                                                      |    21 |      5 |     0 |       2 |
| transfer           | component | transfer, transfer-panel                                                         |    16 |      4 |     5 |       4 |
| tree-select        | component | tree-select                                                                      |    80 |     22 |     8 |      23 |
| upload             | component | upload                                                                           |    27 |      1 |     4 |       5 |
| avatar             | component | avatar, avatar-group                                                             |    18 |      1 |     2 |       0 |
| badge              | component | badge                                                                            |    10 |      0 |     2 |       1 |
| calendar           | component | calendar                                                                         |     4 |      2 |     2 |       4 |
| card               | component | card                                                                             |     7 |      0 |     3 |       0 |
| carousel           | component | carousel, carousel-item                                                          |    15 |      1 |     2 |       4 |
| collapse           | component | collapse, collapse-item, collapse-transition                                     |     8 |      2 |     5 |       3 |
| descriptions       | component | descriptions, descriptions-item                                                  |    17 |      0 |     5 |       0 |
| empty              | component | empty                                                                            |     3 |      0 |     3 |       0 |
| image              | component | image, image-viewer                                                              |    33 |      9 |    12 |       2 |
| infinite-scroll    | directive | infinite-scroll                                                                  |     5 |      0 |     0 |       0 |
| pagination         | component | pagination                                                                       |    22 |      7 |     1 |       0 |
| progress           | component | progress                                                                         |    14 |      0 |     1 |       0 |
| result             | component | result                                                                           |     3 |      0 |     4 |       0 |
| skeleton           | component | skeleton, skeleton-item                                                          |     6 |      0 |     2 |       1 |
| table              | component | table, table-column                                                              |    79 |     19 |     7 |      17 |
| table-v2           | component | table-v2, table-v2-column, auto-resizer                                          |    60 |      6 |     8 |       4 |
| tag                | component | tag, check-tag                                                                   |    11 |      4 |     2 |       0 |
| timeline           | component | timeline, timeline-item                                                          |    11 |      0 |     3 |       0 |
| tour               | component | tour, tour-step                                                                  |    28 |      6 |     4 |       0 |
| tree               | component | tree                                                                             |    27 |     13 |     2 |      18 |
| tree-v2            | component | tree-v2                                                                          |    20 |      8 |     2 |      17 |
| statistic          | component | statistic, countdown                                                             |    15 |      2 |     6 |       2 |
| segmented          | component | segmented                                                                        |    11 |      2 |     1 |       0 |
| affix              | component | affix                                                                            |     6 |      2 |     1 |       2 |
| anchor             | component | anchor, anchor-link                                                              |    10 |      2 |     3 |       1 |
| backtop            | component | backtop                                                                          |     4 |      1 |     1 |       0 |
| breadcrumb         | component | breadcrumb, breadcrumb-item                                                      |     4 |      0 |     2 |       0 |
| dropdown           | component | dropdown, dropdown-menu, dropdown-item                                           |    32 |      6 |     5 |       2 |
| menu               | component | menu, sub-menu, menu-item, menu-item-group                                       |    37 |      4 |     7 |       4 |
| page-header        | component | page-header                                                                      |     3 |      1 |     6 |       0 |
| steps              | component | steps, step                                                                      |    11 |      1 |     4 |       0 |
| tabs               | component | tabs, tab-nav, tab-bar, tab-pane                                                 |    15 |     10 |     5 |       8 |
| alert              | component | alert                                                                            |     8 |      1 |     3 |       0 |
| dialog             | component | dialog, overlay                                                                  |    36 |     10 |     5 |       3 |
| drawer             | component | drawer                                                                           |    37 |     12 |     4 |       1 |
| loading            | composite | loading-service, loading-directive                                               |    20 |      0 |     0 |       2 |
| message            | service   | message                                                                          |    15 |      0 |     0 |       9 |
| message-box        | service   | message-box                                                                      |    43 |      0 |     0 |       5 |
| notification       | service   | notification                                                                     |    17 |      0 |     0 |       9 |
| popconfirm         | component | popconfirm                                                                       |    44 |      2 |     2 |       2 |
| popover            | component | popover, popper, popper-arrow, popper-content, popper-trigger, popover-directive |    81 |     12 |     5 |       8 |
| tooltip            | component | tooltip                                                                          |    38 |      7 |     2 |       7 |
| divider            | component | divider                                                                          |     3 |      0 |     1 |       0 |
| watermark          | component | watermark                                                                        |     9 |      0 |     1 |       0 |

待继续核查：无未映射根条目或源码入口。
