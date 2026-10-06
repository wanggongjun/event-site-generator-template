# 可编辑输入

fictional-conference.xlsx 是唯一规范配置源；示例活动、人物、机构、场地和路线全部虚构，邮箱及网站使用保留示例域名。assets/participant-notes.pdf 是公共下载样例。

修改此工作簿后运行 python scripts/validate_config.py，再运行 python scripts/generate.py。生成 JSON、横幅和材料不反向写回工作簿。新会议使用 scripts/create_sample.py 复制到新的输入目录，修改 slug 和内容，生成到独立输出目录。

完整字段、精确表头、日期、素材与安全再生成约束见 ../docs/config-schema.md。不要在工作簿或公共素材中存密码、密钥或参会者私人信息。
