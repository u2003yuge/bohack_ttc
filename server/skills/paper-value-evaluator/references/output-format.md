# 简单 JSON 输出格式

只保留六块，每个字段直接写内容。使用 [assets/result-template.json](../assets/result-template.json) 作为起点，未知填 null，来源统一放 sources，缺失或有争议的内容统一放 notes。

| 字段 | 内容 |
| --- | --- |
| input | title：用户输入的论文标题；description：可为空的论文描述；extra_context：用户额外提供的作者、年份、标识符、候选人或岗位信息，未提供时留空。 |
| paper | official_title：查到的正式题名；official_url：具体论文页面；authors：按原顺序记录的作者；identifiers：DOI、arXiv ID 等；field：主要领域、细分方向及关键词；research_type：原创研究、综述、数据集等；abstract_summary：中文摘要概述，标明对应版本；research_content：研究问题、方法及作者声称的主要贡献和结果；other_details：题名变更、版本关系、摘要来源等其他信息。 |
| publication | venue_name：期刊或会议全称及缩写；venue_type：期刊、会议、Workshop、预印本平台等；venue_url：渠道官网；publisher_or_organizer：出版方或主办方；year：目标发表版本的年份；status：发表、录用或预印本情况及依据；track_and_format：主会或附属轨道、长短文等文种；peer_review：同行评审情况；venue_rankings：适用的渠道等级与分区；indexing：数据库或目录收录情况；metrics：JIF、CiteScore、SJR 等指标；other_details：渠道背景与权威性依据、ISSN、日期、历史变化等补充信息。 |
| paper_evaluation | paper_level：有依据的论文发表层级标签；level_basis：判断依据及适用边界；research_quality：基于已阅读材料的内容分析及限制；citations：引用量及统计口径；recognitions：官方奖项、提名或展示形式；open_resources：代码、数据、模型与复现材料；authorship：署名标记及公开贡献声明；corrections_and_retractions：找到的更正、撤稿、撤回或关注声明；other_details：其他有助于评价的信息。 |
| sources | 数组，每条只含 title（标题）、url（具体链接）、information（支持的信息、适用年份与范围；必要时附发布机构、查询日期、短原文或页码）。 |
| notes | 字符串数组：没查到的内容、不可访问的资料、同名候选、来源矛盾、输入与查证结果的差异及必要限制。 |

input 保留用户原文，未提供的输入填 null，不用检索结果倒填。无法区分同名论文时，未确认的主字段及等级留空，在 notes 分别列出候选与链接；不把多个候选拼成一篇，不另设匹配状态或数值置信度。

年份用整数或 null；日期写入相关内容，尽量使用 YYYY-MM-DD，只知道年月或年份就保留原精度。其他事实优先使用易读文字，确有需要时可直接用数组或对象，不添加 value/status/source_ids 等核实信息包装。publication.status 是论文实际发表情况的事实字段，可以保留，不是逐字段核实状态。

资料可以详细，不限定文字长度。更多信息放对应 other_details，无需新增独立的版本、检索日志、核实状态、评估范围或证据完整度结构。简化结构不意味着删除影响判断的年份、范围和限制。

venue_rankings 随文字保留体系、发布机构、目录或指标年份、学科类别、原始等级及适用轨道和文种；中科院历史分区保留大类、小类及有证据的 Top 标识。不同体系、年份和学科可以分段或用文字数组列出，不合成同一尺度，不只挑最高分区。明确区分论文发表时的等级与本次最新可核实等级，不以当前目录倒推；转引资料注明归属、年份及未直接核实的限制。

indexing 区分期刊层面和目标论文条目的收录，保留目录年份及来源刊或扩展版等区别；当前期刊收录不能证明目标论文发表时已被收录。metrics 保留指标名称、值、所属年份、提供者及查询日期，不将报告发布年份当成指标年份。官方录用率只有届次、轨道和统计口径清楚时才写入 publication.other_details，不自行用不明分母计算。

citations 随数字保留平台、查询日期、目标记录及版本归并范围，不同平台分开写、不相加；未知不等于零。示例（虚构）：“平台甲显示 120 次引用，查询于 2026-11-13，统计包含预印本与正式版。”

paper_level 是有依据的发表层级描述，level_basis 写明目录年份及适用性，不能把渠道等级当作单篇论文质量。research_quality 直接说明只读到摘要还是已读全文，以及哪些结论尚无法判断，不另设状态枚举。

status 用中文说明已发表、已在线发表、已录用未发表、仅发现预印本或仅有投稿声明等情况。只有用户自述时保留“用户提供、未独立核实”的限定；仅找到预印本不能断言从未录用或评审。会议论文共用 venue_name，不伪造“发表期刊”；arXiv 可作为预印本平台记录，不附期刊分区。主会、Workshop、Findings、短文等须区分；Oral、Poster、Spotlight 在 recognitions 中明确为展示形式，不能当作正式奖项。

open_resources 记录材料类型、链接、开放情况及已知复现信息；未执行复现就不能写“已验证可复现”。authorship 只写公开署名或贡献事实；候选人身份未提供或未匹配时，不将论文贡献归给简历持有人。

corrections_and_retractions 只填找到的公告或可靠记录，保留类型、日期、对应版本与原因。未查到时填 null，在 notes 说明核查范围，不写成“确认无问题”；普通勘误、预印本撤回与正式撤稿分别表述。

sources 的 information 要说明具体支持什么，仅有网址列表不够；统一来源即可，不用逐字段分配来源 ID。需要时注明官方原始记录、作者自述或机构转引，以及对应目录条目、文档页码和访问日期。只记录实际读取且支持结论的具体页面或文件，未读取正文的链接放 notes，不用网站首页冒充条目证据。无公网地址的用户材料可用 url=null，并在 information 写明文件名及相关内容，不编造网址。

保留模板的键；未知作者、指标、引用量或奖项填 null，不用空数组表示不存在。sources 和 notes 无记录时用 []。来源冲突时将争议字段留空，在 notes 并列保留说法和链接。历史复杂格式不再作为输出要求，已生成的历史报告无需改写。保存后用普通 JSON 解析器检查即可，无需 JSON Schema 或额外依赖。
