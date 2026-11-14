# 简单 JSON 输出格式

只保留六块，每个字段直接写内容。使用 [assets/report-template.json](../assets/report-template.json) 作为起点，未知填 null，来源统一放 sources，缺失或有争议的内容统一放 notes。

| 字段 | 内容 |
| --- | --- |
| input | project_name：输入项目名；project_year：输入年份；organization：输入的项目所属公司或集体，如企业、学校、实验室或团队；role：输入角色，可为空。 |
| project | official_name：正式名称；official_website：官网；project_type：项目类型；organizations：公开资料中的所属、主办、资助及合作机构；description：背景、目标和介绍；other_details：别名、编号、总项目与子项目关系等其他信息。 |
| year_data | year：查证后的项目年份或届次；timeline：周期与进展；work_content：当年的任务和交付范围；technology：技术路线和方法；participation：参与资格、申请与选拔；resources：经费、设备等资源；team：团队规模与分工；outcomes：成果、验收、应用和外部评价；other_details：当年其他有用信息。 |
| role_information | role_name：公开资料中的对应角色名；responsibilities：该项目中公开记载的职责；other_details：角色分工、交付责任、署名规则等补充信息。 |
| sources | 数组，每条只含 title（标题）、url（具体链接）、information（该来源支持的信息及其适用年份、范围；需要时附短原文和页码）。 |
| notes | 字符串数组：没查到的内容、无法访问的资料、同名候选、来源矛盾和必要限制。 |

年份使用整数或 null；输入为年份区间或届次时保留原文。其他事实优先使用易读文字，确有需要时可直接用数组或对象，不添加 value/status/source_ids 等包装。保留数字的单位、时间、范围和限定，如“计划资助不超过人民币 100 万元（2024 年立项公告）”“12 人（2024 年子课题团队）”。示例均为虚构。

input 保留用户原文；未提供的输入填 null，不用检索结果倒填。organization 用于缩小检索范围，不代表归属已核实；公开查到的机构及其关系写入 project.organizations，与输入不一致时在 notes 说明。

资料可以详细，不限定文字长度；更多内容写入对应 other_details。其他年份的资料可作标明年份的补充，不能填补目标年份的字段；当前仓库指标注明访问日期。不自行计算指标，不把宣传性说法写成已独立核实的事实。

role 只保留用户输入。只有找到该项目中对应角色的公开资料，才填写 role_name 和 responsibilities；角色为空或未匹配时留空，其他公开分工可放 other_details。不要用通用岗位介绍推定实际职责。项目和角色资料不能证明投递者实际参与或贡献，在 notes 中说明这一限制。

sources 的 information 要说明具体支持什么，仅有网址列表不够；无需逐字段分配来源 ID。未读到正文的链接放 notes，不冒充已读取来源。无公网地址的用户材料可用 url=null，并在 information 写明文件名和相关内容，不编造网址。

保留模板的键，未知用 null，sources 和 notes 无记录时用 []。来源冲突时将争议字段留空，在 notes 并列保留不同说法和链接；无法区分同名项目时也不要合并填入主字段，在 notes 分别列出候选及资料。无需版本、检索日志、状态或评分结构，已有旧结果无需改写。保存后用普通 JSON 解析器检查即可，无需额外依赖。
