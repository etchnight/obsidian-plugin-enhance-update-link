# Enhance Update Link

增强更新链接，会监控章节标题移动/修改，并自动更新指向原章节标题的链接

## 运行逻辑

1. 检测到标题增加或减少，记录一次
2. 再次检测到标题增加或减少，如果是增加->增加或减少->减少，覆盖上次记录，继续检测；如果是增加->减少或减少 ->增加，进入下一步
3. 如果增加和减少的标题中有重复标题，更新链接
4. 清空记录，继续检测

> [!NOTE]
> 在位编辑一个标题（重命名标题）时，既会导致标题增加，又会导致标题减少，所以会触发一次更新。

> [!WARN]
> 注意，本逻辑有一个问题无法避免：如果增加和减少的标题相同，但并非是逻辑上的移动（如增加了'苹果'文档下的‘颜色’标题，但减少了'李子'文档下的‘颜色’标题），会导致链接更新错误。但这种情况出现的概率较低。