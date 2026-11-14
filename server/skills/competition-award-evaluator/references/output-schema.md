# 简单 JSON 输出格式

只保留六块，每个字段直接写内容。使用 assets/result-template.json 作为起点，未知填 null，来源统一放 sources，缺失或有争议的内容统一放 notes。

| 字段 | 内容 |
| --- | --- |
| input | competition_name：输入赛事名；award_name：输入奖项；award_year：输入年份；age_at_award：输入年龄。 |
| competition | official_name：官方全称；official_website：官网；organizers：主办方；description：赛事介绍；eligibility：参赛资格；other_details：其他有用信息。 |
| year_data | year：查证后的届次年份；division_and_stage：组别、赛道、赛区及阶段；participants：参赛规模；winners：目标奖项获奖数量；award_rate：已发布获奖比例；award_structure：奖项设置；other_details：当届其他信息。 |
| prizes_and_rules | cash_prize：目标奖项奖金；other_rewards：非现金及附条件奖励；competition_format：赛制；judging_rules：评审方法；other_details：其他奖金与规则信息。 |
| sources | 数组，每条只含 title（标题）、url（具体链接）、information（该来源支持的信息及其适用年份/口径）。 |
| notes | 字符串数组：没查到的内容、无法访问的资料、存在的矛盾和必要限制。 |

年份和年龄用整数或 null；其他事实优先使用易读文字，确有需要时可直接用数组或对象，但不添加核实状态等包装。统计数、比例和金额随文字保留单位、适用范围和原文限定，如“1200 队（2024 年本科组初赛有效参赛）”“3%（官方公布的当届本科组一等奖比例）”“人民币 10000 元/队（公告承诺，税前税后未说明）”。示例均为虚构。

不能用其他年份的数据补齐当届字段，不自行计算比例或奖金换算。更详细的信息写入对应 other_details，不需要新增日志、版本、状态或评分结构。历史复杂格式不再作为输出要求，已生成的历史结果无需改写。

sources 的 information 说明具体支持什么；仅有网址列表不够。统一来源即可，不用给每个字段分配来源 ID。未读到的链接放 notes，不能伪装成已读取来源。无公网地址的用户材料可用 url=null，并在 information 写明文件名和相关内容；不编造网址。

保留模板的键，null 表示未知，sources=[] 表示没有已记录来源，notes=[] 表示没有额外备注。未知主办方使用 null，不用空列表表示没有主办方。保存后用普通 JSON 解析器检查即可，无需 JSON Schema 或额外依赖。
