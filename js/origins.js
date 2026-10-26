// 產地：國家與主要產區的清單、從文字比對產地、產地地圖的統計（純函式，不 import 任何東西，Node 可直接測）
// 豆子的 country（國家代碼）、region（產區 key）是選填；沒選國家時用名稱和產地文字即時比對，比對結果不儲存
// 座標是產區的大概位置（緯度、經度），只用來在地圖上畫圓點；origins-test 會檢查每個點都落在自己的國家裡
// aliases：比對用（中英、常見寫法、知名莊園與處理站）；比對前會去掉重音、轉小寫、「臺」→「台」，所以這裡不用寫大小寫和重音的變化

export const ORIGIN_GROUPS = { africa: '非洲・中東', americas: '美洲', asia: '亞洲・大洋洲' };

// view：放大到這個國家時的範圍 [西, 南, 東, 北]（經緯度）；沒寫就用地圖資料裡最大那塊陸地加上產區的範圍
export const COUNTRIES = [
  { code: 'ET', group: 'africa', zh: '衣索比亞', en: 'Ethiopia', aliases: ['衣索比亞', '衣索匹亞', '依索比亞', '埃塞俄比亞', 'ethiopia'] },
  { code: 'KE', group: 'africa', zh: '肯亞', en: 'Kenya', aliases: ['肯亞', '肯尼亞', 'kenya'] },
  { code: 'TZ', group: 'africa', zh: '坦尚尼亞', en: 'Tanzania', aliases: ['坦尚尼亞', '坦桑尼亞', 'tanzania'] },
  { code: 'RW', group: 'africa', zh: '盧安達', en: 'Rwanda', aliases: ['盧安達', '盧旺達', 'rwanda'] },
  { code: 'BI', group: 'africa', zh: '蒲隆地', en: 'Burundi', aliases: ['蒲隆地', '布隆迪', 'burundi'] },
  { code: 'UG', group: 'africa', zh: '烏干達', en: 'Uganda', aliases: ['烏干達', 'uganda'] },
  { code: 'CD', group: 'africa', zh: '剛果民主共和國', en: 'DR Congo', aliases: ['剛果', 'congo', 'drc'] },
  { code: 'YE', group: 'africa', zh: '葉門', en: 'Yemen', aliases: ['葉門', '也門', 'yemen'] },
  { code: 'CO', group: 'americas', zh: '哥倫比亞', en: 'Colombia', aliases: ['哥倫比亞', 'colombia'] },
  { code: 'PA', group: 'americas', zh: '巴拿馬', en: 'Panama', aliases: ['巴拿馬', 'panama'] },
  { code: 'CR', group: 'americas', zh: '哥斯大黎加', en: 'Costa Rica', aliases: ['哥斯大黎加', '哥斯達黎加', 'costa rica'] },
  { code: 'GT', group: 'americas', zh: '瓜地馬拉', en: 'Guatemala', aliases: ['瓜地馬拉', '瓜地瑪拉', '危地馬拉', 'guatemala'] },
  { code: 'HN', group: 'americas', zh: '宏都拉斯', en: 'Honduras', aliases: ['宏都拉斯', '洪都拉斯', 'honduras'] },
  { code: 'SV', group: 'americas', zh: '薩爾瓦多', en: 'El Salvador', aliases: ['薩爾瓦多', 'el salvador'] },
  { code: 'NI', group: 'americas', zh: '尼加拉瓜', en: 'Nicaragua', aliases: ['尼加拉瓜', 'nicaragua'] },
  { code: 'MX', group: 'americas', zh: '墨西哥', en: 'Mexico', aliases: ['墨西哥', 'mexico'] },
  { code: 'JM', group: 'americas', zh: '牙買加', en: 'Jamaica', aliases: ['牙買加', 'jamaica'] },
  { code: 'DO', group: 'americas', zh: '多明尼加', en: 'Dominican Republic', aliases: ['多明尼加', 'dominican', 'dominicana'] },
  { code: 'BR', group: 'americas', zh: '巴西', en: 'Brazil', aliases: ['巴西', 'brazil', 'brasil'] },
  { code: 'PE', group: 'americas', zh: '秘魯', en: 'Peru', aliases: ['秘魯', '祕魯', 'peru'] },
  { code: 'BO', group: 'americas', zh: '玻利維亞', en: 'Bolivia', aliases: ['玻利維亞', 'bolivia'] },
  { code: 'EC', group: 'americas', zh: '厄瓜多', en: 'Ecuador', aliases: ['厄瓜多', 'ecuador'] },
  { code: 'US', group: 'americas', zh: '美國', en: 'United States', aliases: ['美國', '夏威夷', 'hawaii', 'usa'], view: [-160.5, 18.7, -154.6, 22.4] },
  { code: 'ID', group: 'asia', zh: '印尼', en: 'Indonesia', aliases: ['印尼', '印度尼西亞', 'indonesia', '蘇門答臘', 'sumatra'] },
  { code: 'PG', group: 'asia', zh: '巴布亞紐幾內亞', en: 'Papua New Guinea', aliases: ['巴布亞紐幾內亞', '巴布亞新幾內亞', '巴紐', 'papua new guinea', 'png'] },
  { code: 'TW', group: 'asia', zh: '台灣', en: 'Taiwan', aliases: ['台灣', 'taiwan'] },
  { code: 'CN', group: 'asia', zh: '中國', en: 'China', aliases: ['中國', '雲南', 'china', 'yunnan'] },
  { code: 'IN', group: 'asia', zh: '印度', en: 'India', aliases: ['印度', 'india'] },
  { code: 'VN', group: 'asia', zh: '越南', en: 'Vietnam', aliases: ['越南', 'vietnam', 'viet nam'] },
  { code: 'TH', group: 'asia', zh: '泰國', en: 'Thailand', aliases: ['泰國', 'thailand'] },
  { code: 'LA', group: 'asia', zh: '寮國', en: 'Laos', aliases: ['寮國', '老撾', 'laos'] },
  { code: 'MM', group: 'asia', zh: '緬甸', en: 'Myanmar', aliases: ['緬甸', 'myanmar', 'burma'] },
];

// key：<國家代碼>.<英文小寫>，存在 beans.region，**不能改名**（改了舊豆子就對不上）
export const REGIONS = [
  // 衣索比亞
  { key: 'ET.yirgacheffe', zh: '耶加雪菲', en: 'Yirgacheffe', lat: 6.15, lon: 38.2,
    aliases: ['耶加雪菲', '耶加雪啡', '耶加', 'yirgacheffe', 'yirgachefe', 'yirga', 'gedeo', 'gedeb', '格迪布', 'kochere', '科契爾', 'konga', '孔加', 'idido', 'aricha', '阿麗夏', 'worka', '沃卡', 'chelbesa', '切貝薩'] },
  { key: 'ET.sidama', zh: '西達摩', en: 'Sidama', lat: 6.7, lon: 38.55,
    aliases: ['西達摩', '西達瑪', '希達摩', 'sidama', 'sidamo', 'bensa', '班莎', 'bombe', '邦貝', 'shantawene', '香塔維內', 'aroresa', '阿羅瑞莎'] },
  { key: 'ET.guji', zh: '古吉', en: 'Guji', lat: 5.8, lon: 38.95,
    aliases: ['古吉', '谷吉', 'guji', 'hambela', '罕貝拉', 'shakiso', '夏奇索', 'uraga', '烏拉嘎'] },
  { key: 'ET.westarsi', zh: '西阿爾西', en: 'West Arsi', lat: 7.0, lon: 38.95,
    aliases: ['西阿爾西', '阿爾西', 'arsi', 'nensebo', '南塞波'] },
  { key: 'ET.harrar', zh: '哈拉', en: 'Harrar', lat: 9.3, lon: 41.9,
    aliases: ['哈拉', '哈拉爾', '哈勒爾', 'harrar', 'harar'] },
  { key: 'ET.limu', zh: '利姆', en: 'Limu', lat: 8.0, lon: 37.0, aliases: ['利姆', '林姆', 'limu'] },
  { key: 'ET.jimma', zh: '吉瑪', en: 'Jimma', lat: 7.65, lon: 36.8, aliases: ['吉瑪', '金瑪', 'jimma', 'djimmah'] },
  { key: 'ET.kaffa', zh: '卡法', en: 'Kaffa', lat: 7.3, lon: 36.25, aliases: ['卡法', 'kaffa', 'kafa', 'bonga'] },
  { key: 'ET.lekempti', zh: '列坎提', en: 'Lekempti', lat: 9.05, lon: 36.5,
    aliases: ['列坎提', '列卡姆提', 'lekempti', 'nekemte', 'wollega', 'wallaga'] },
  // 肯亞
  { key: 'KE.nyeri', zh: '涅里', en: 'Nyeri', lat: -0.4, lon: 36.95, aliases: ['涅里', '尼耶利', 'nyeri'] },
  { key: 'KE.kirinyaga', zh: '基里尼亞加', en: 'Kirinyaga', lat: -0.5, lon: 37.3, aliases: ['基里尼亞加', '克里尼亞加', 'kirinyaga'] },
  { key: 'KE.muranga', zh: '穆蘭卡', en: "Murang'a", lat: -0.75, lon: 37.1, aliases: ['穆蘭卡', '慕蘭卡', 'muranga'] },
  { key: 'KE.kiambu', zh: '基安布', en: 'Kiambu', lat: -1.1, lon: 36.85, aliases: ['基安布', 'kiambu'] },
  { key: 'KE.embu', zh: '恩布', en: 'Embu', lat: -0.55, lon: 37.45, aliases: ['恩布', 'embu'] },
  // 坦尚尼亞、盧安達、蒲隆地、烏干達、剛果
  { key: 'TZ.kilimanjaro', zh: '吉力馬札羅', en: 'Kilimanjaro', lat: -3.3, lon: 37.35,
    aliases: ['吉力馬札羅', '乞力馬札羅', '吉利馬札羅', 'kilimanjaro', 'moshi'] },
  { key: 'TZ.mbeya', zh: '姆貝亞', en: 'Mbeya', lat: -8.95, lon: 33.45, aliases: ['姆貝亞', 'mbeya'] },
  { key: 'RW.western', zh: '西部省', en: 'Western Province', lat: -2.3, lon: 29.3,
    aliases: ['nyamasheke', '尼亞馬謝克', 'rusizi', 'karongi', '卡隆吉', 'rutsiro'] },
  { key: 'RW.southern', zh: '南部省', en: 'Southern Province', lat: -2.6, lon: 29.75, aliases: ['huye', '胡耶', 'nyamagabe', 'nyaruguru'] },
  { key: 'BI.kayanza', zh: '卡揚扎', en: 'Kayanza', lat: -2.95, lon: 29.65, aliases: ['卡揚扎', 'kayanza'] },
  { key: 'BI.ngozi', zh: '恩戈齊', en: 'Ngozi', lat: -2.9, lon: 29.85, aliases: ['恩戈齊', 'ngozi'] },
  { key: 'UG.elgon', zh: '艾爾貢山', en: 'Mount Elgon', lat: 1.15, lon: 34.45, aliases: ['艾爾貢', '埃爾貢', 'elgon', 'bugisu', '布吉蘇'] },
  { key: 'UG.rwenzori', zh: '魯文佐里', en: 'Rwenzori', lat: 0.4, lon: 30.15, aliases: ['魯文佐里', 'rwenzori'] },
  { key: 'CD.kivu', zh: '基伍', en: 'Kivu', lat: -2.6, lon: 28.6, aliases: ['基伍', 'kivu'] },
  // 葉門
  { key: 'YE.haraz', zh: '哈拉茲', en: 'Haraz', lat: 15.15, lon: 43.6, aliases: ['哈拉茲', '哈拉滋', 'haraz'] },
  { key: 'YE.banimatar', zh: '巴尼馬塔', en: 'Bani Matar', lat: 15.3, lon: 44.0, aliases: ['巴尼馬塔', '馬塔利', 'bani matar', 'matari'] },
  // 哥倫比亞
  { key: 'CO.huila', zh: '薇拉', en: 'Huila', lat: 2.2, lon: -75.8, aliases: ['薇拉', '慧蘭', 'huila', 'pitalito', '皮塔利托'] },
  { key: 'CO.narino', zh: '納里尼奧', en: 'Nariño', lat: 1.4, lon: -77.3, aliases: ['納里尼奧', '娜玲瓏', '納里諾', 'narino'] },
  { key: 'CO.cauca', zh: '考卡', en: 'Cauca', lat: 2.45, lon: -76.6, aliases: ['考卡', 'cauca', 'popayan', '波帕揚', 'inza'] },
  { key: 'CO.tolima', zh: '托利馬', en: 'Tolima', lat: 3.6, lon: -75.4, aliases: ['托利馬', 'tolima', 'planadas', '普拉納達斯'] },
  { key: 'CO.antioquia', zh: '安提奧基亞', en: 'Antioquia', lat: 6.25, lon: -75.6, aliases: ['安提奧基亞', '安蒂奧基亞', 'antioquia', 'medellin', '麥德林'] },
  { key: 'CO.quindio', zh: '金迪奧', en: 'Quindío', lat: 4.5, lon: -75.7, aliases: ['金迪奧', '昆迪奧', 'quindio'] },
  // 巴拿馬
  { key: 'PA.boquete', zh: '波奎特', en: 'Boquete', lat: 8.8, lon: -82.45,
    aliases: ['波奎特', '波魁特', '波奎蒂', 'boquete', '翡翠莊園', 'esmeralda', '艾利達', 'elida', '鑽石山', 'diamond mountain'] },
  { key: 'PA.volcan', zh: '沃肯', en: 'Volcán', lat: 8.8, lon: -82.65,
    aliases: ['沃肯', '巴魯火山', 'volcan baru', 'janson', '詹森', '卡門莊園', 'carmen estate'] },
  // 哥斯大黎加
  { key: 'CR.tarrazu', zh: '塔拉珠', en: 'Tarrazú', lat: 9.65, lon: -84.05, aliases: ['塔拉珠', '塔拉蘇', 'tarrazu'] },
  { key: 'CR.westvalley', zh: '西部山谷', en: 'West Valley', lat: 10.1, lon: -84.4, aliases: ['西部山谷', '西谷', 'west valley', 'valle occidental', 'naranjo', '納蘭荷'] },
  { key: 'CR.centralvalley', zh: '中央山谷', en: 'Central Valley', lat: 10.0, lon: -84.1, aliases: ['中央山谷', 'central valley', 'valle central', '三河', 'tres rios'] },
  // 瓜地馬拉
  { key: 'GT.antigua', zh: '安提瓜', en: 'Antigua', lat: 14.55, lon: -90.75, aliases: ['安提瓜', '安地瓜', 'antigua'] },
  { key: 'GT.huehuetenango', zh: '薇薇特南果', en: 'Huehuetenango', lat: 15.4, lon: -91.5, aliases: ['薇薇特南果', '薇薇', 'huehuetenango', 'huehue'] },
  { key: 'GT.atitlan', zh: '阿提特蘭', en: 'Atitlán', lat: 14.65, lon: -91.2, aliases: ['阿提特蘭', '阿蒂特蘭', 'atitlan'] },
  { key: 'GT.acatenango', zh: '阿卡特南果', en: 'Acatenango', lat: 14.5, lon: -90.9, aliases: ['阿卡特南果', 'acatenango'] },
  // 宏都拉斯、薩爾瓦多、尼加拉瓜、墨西哥
  { key: 'HN.santabarbara', zh: '聖塔芭芭拉', en: 'Santa Bárbara', lat: 14.95, lon: -88.2, aliases: ['聖塔芭芭拉', '聖芭芭拉', 'santa barbara'] },
  { key: 'HN.marcala', zh: '瑪卡拉', en: 'Marcala', lat: 14.15, lon: -88.0, aliases: ['瑪卡拉', 'marcala'] },
  { key: 'HN.copan', zh: '科潘', en: 'Copán', lat: 14.8, lon: -88.9, aliases: ['科潘', 'copan'] },
  { key: 'SV.apaneca', zh: '阿帕內卡', en: 'Apaneca-Ilamatepec', lat: 13.85, lon: -89.75,
    aliases: ['阿帕內卡', '聖塔安娜', '聖安娜', 'apaneca', 'ilamatepec', 'santa ana', 'ahuachapan'] },
  { key: 'NI.jinotega', zh: '希諾特加', en: 'Jinotega', lat: 13.1, lon: -86.0, aliases: ['希諾特加', 'jinotega'] },
  { key: 'NI.nuevasegovia', zh: '新塞哥維亞', en: 'Nueva Segovia', lat: 13.65, lon: -86.35, aliases: ['新塞哥維亞', 'nueva segovia', 'dipilto'] },
  { key: 'NI.matagalpa', zh: '馬塔加爾帕', en: 'Matagalpa', lat: 12.9, lon: -85.9, aliases: ['馬塔加爾帕', 'matagalpa'] },
  { key: 'MX.chiapas', zh: '恰帕斯', en: 'Chiapas', lat: 16.5, lon: -92.5, aliases: ['恰帕斯', 'chiapas'] },
  { key: 'MX.oaxaca', zh: '瓦哈卡', en: 'Oaxaca', lat: 16.9, lon: -96.7, aliases: ['瓦哈卡', 'oaxaca'] },
  { key: 'MX.veracruz', zh: '韋拉克魯斯', en: 'Veracruz', lat: 19.5, lon: -96.95, aliases: ['韋拉克魯斯', 'veracruz'] },
  // 加勒比海
  { key: 'JM.bluemountain', zh: '藍山', en: 'Blue Mountain', lat: 18.05, lon: -76.6, aliases: ['藍山', 'blue mountain'] },
  { key: 'DO.barahona', zh: '巴拉奧納', en: 'Barahona', lat: 18.15, lon: -71.2, aliases: ['巴拉奧納', 'barahona'] },
  // 南美洲
  { key: 'BR.suldeminas', zh: '南米納斯', en: 'Sul de Minas', lat: -21.6, lon: -45.4, aliases: ['南米納斯', '南米拿斯', 'sul de minas'] },
  { key: 'BR.cerrado', zh: '喜拉朵', en: 'Cerrado Mineiro', lat: -18.9, lon: -46.9, aliases: ['喜拉朵', '塞拉多', 'cerrado'] },
  { key: 'BR.mogiana', zh: '摩吉安納', en: 'Mogiana', lat: -20.6, lon: -47.3, aliases: ['摩吉安納', '莫吉安納', 'mogiana'] },
  { key: 'BR.chapada', zh: '鑽石高原', en: 'Chapada Diamantina', lat: -13.0, lon: -41.4, aliases: ['鑽石高原', 'chapada diamantina', 'chapada'] },
  { key: 'PE.cajamarca', zh: '卡哈馬卡', en: 'Cajamarca', lat: -5.8, lon: -78.85, aliases: ['卡哈馬卡', 'cajamarca', 'jaen', '哈恩'] },
  { key: 'PE.junin', zh: '胡寧', en: 'Junín', lat: -11.1, lon: -75.3, aliases: ['胡寧', 'junin', 'chanchamayo', '羌羌馬約'] },
  { key: 'PE.cusco', zh: '庫斯科', en: 'Cusco', lat: -13.0, lon: -72.6, aliases: ['庫斯科', 'cusco', 'cuzco'] },
  { key: 'PE.puno', zh: '普諾', en: 'Puno', lat: -14.3, lon: -69.4, aliases: ['普諾', 'puno', 'sandia'] },
  { key: 'BO.caranavi', zh: '卡拉納維', en: 'Caranavi', lat: -15.85, lon: -67.55, aliases: ['卡拉納維', 'caranavi', 'yungas', '永加斯'] },
  { key: 'EC.loja', zh: '洛哈', en: 'Loja', lat: -4.0, lon: -79.2, aliases: ['洛哈', 'loja'] },
  { key: 'EC.pichincha', zh: '皮欽查', en: 'Pichincha', lat: 0.0, lon: -78.6, aliases: ['皮欽查', 'pichincha'] },
  // 夏威夷
  { key: 'US.kona', zh: '可娜', en: 'Kona', lat: 19.5, lon: -155.85, aliases: ['可娜', '科納', '可那', 'kona'] },
  // 印尼、巴布亞紐幾內亞
  { key: 'ID.gayo', zh: '迦佑', en: 'Aceh Gayo', lat: 4.6, lon: 96.85, aliases: ['迦佑', '卡猶', '亞齊', 'gayo', 'aceh'] },
  { key: 'ID.mandheling', zh: '曼特寧（北蘇門答臘）', en: 'Mandheling (North Sumatra)', lat: 2.3, lon: 98.95,
    aliases: ['曼特寧', '曼特林', 'mandheling', 'mandailing', 'lintong', '林東', 'toba', '多巴湖'] },
  { key: 'ID.java', zh: '爪哇', en: 'Java', lat: -7.95, lon: 114.0, aliases: ['爪哇', 'java', 'ijen', '伊真'] },
  { key: 'ID.toraja', zh: '托那加', en: 'Toraja (Sulawesi)', lat: -3.0, lon: 119.85,
    aliases: ['托那加', '托拉加', 'toraja', 'sulawesi', '蘇拉威西', 'kalosi'] },
  { key: 'ID.bali', zh: '峇里島', en: 'Bali', lat: -8.25, lon: 115.3, aliases: ['峇里', '巴里島', 'bali', 'kintamani', '京打馬尼'] },
  { key: 'PG.easternhighlands', zh: '東部高地', en: 'Eastern Highlands', lat: -6.1, lon: 145.4, aliases: ['東部高地', 'eastern highlands', 'goroka'] },
  { key: 'PG.westernhighlands', zh: '西部高地', en: 'Western Highlands', lat: -5.85, lon: 144.25,
    aliases: ['西部高地', 'western highlands', 'sigri', 'wahgi', 'mount hagen', '哈根'] },
  // 台灣、中國
  { key: 'TW.alishan', zh: '阿里山', en: 'Alishan', lat: 23.47, lon: 120.75, aliases: ['阿里山', 'alishan'] },
  { key: 'TW.gukeng', zh: '古坑', en: 'Gukeng', lat: 23.62, lon: 120.6, aliases: ['古坑', '雲林', 'gukeng'] },
  { key: 'TW.nantou', zh: '南投', en: 'Nantou', lat: 23.9, lon: 120.95, aliases: ['南投', 'nantou', '國姓', '惠蓀'] },
  { key: 'TW.pingtung', zh: '屏東', en: 'Pingtung', lat: 22.6, lon: 120.65, aliases: ['屏東', 'pingtung', '泰武', '三地門'] },
  { key: 'CN.puer', zh: '普洱', en: "Pu'er", lat: 22.8, lon: 100.95, aliases: ['普洱', '思茅', 'puer'] },
  { key: 'CN.baoshan', zh: '保山', en: 'Baoshan', lat: 25.1, lon: 99.15, aliases: ['保山', 'baoshan'] },
  { key: 'CN.dehong', zh: '德宏', en: 'Dehong', lat: 24.45, lon: 98.6, aliases: ['德宏', 'dehong'] },
  // 印度、東南亞
  { key: 'IN.chikmagalur', zh: '奇克馬加盧爾', en: 'Chikmagalur', lat: 13.3, lon: 75.75,
    aliases: ['奇克馬加盧爾', 'chikmagalur', 'chikkamagaluru', '邁索爾', 'mysore'] },
  { key: 'VN.dalat', zh: '大叻', en: 'Da Lat', lat: 11.95, lon: 108.45, aliases: ['大叻', '林同', 'dalat', 'da lat', 'lam dong'] },
  { key: 'TH.chiangrai', zh: '清萊', en: 'Chiang Rai', lat: 19.9, lon: 99.8, aliases: ['清萊', 'chiang rai', 'doi chaang'] },
  { key: 'TH.chiangmai', zh: '清邁', en: 'Chiang Mai', lat: 18.8, lon: 98.95, aliases: ['清邁', 'chiang mai'] },
  { key: 'LA.bolaven', zh: '波羅芬高原', en: 'Bolaven Plateau', lat: 15.2, lon: 106.3, aliases: ['波羅芬', 'bolaven'] },
  { key: 'MM.shan', zh: '撣邦', en: 'Shan State', lat: 21.0, lon: 96.9, aliases: ['撣邦', 'shan state', 'ywangan'] },
].map((r) => ({ ...r, country: r.key.split('.')[0] }));

export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
export const REGION_BY_KEY = new Map(REGIONS.map((r) => [r.key, r]));
export const regionsOf = (code) => REGIONS.filter((r) => r.country === code);

/* ===== 比對 ===== */

// 去掉重音（Nariño → narino）、撇號，轉小寫，「臺」→「台」
export const normalizeText = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/['’`]/g, '').toLowerCase().replace(/臺/g, '台').replace(/\s+/g, ' ');

const ALIASES = [
  ...COUNTRIES.flatMap((c) => c.aliases.map((a) => ({ text: normalizeText(a), country: c.code, region: '' }))),
  ...REGIONS.flatMap((r) => r.aliases.map((a) => ({ text: normalizeText(a), country: r.country, region: r.key }))),
];

/** 文字裡出現的所有別名（英文別名前面不能接英文字母，例如 shan 不會比對到 shantawene）；被更長的比對包住的不算（印度尼西亞 不算 印度） */
function findAliases(text) {
  const found = [];
  for (const a of ALIASES) {
    const latin = /^[a-z]/.test(a.text);
    for (let i = text.indexOf(a.text); i !== -1; i = text.indexOf(a.text, i + 1)) {
      if (latin && /[a-z]/.test(text[i - 1] ?? '')) continue;
      found.push({ ...a, start: i, end: i + a.text.length });
    }
  }
  return found.filter((m) => !found.some((o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start));
}

/**
 * 從文字猜產地 → { country, region }（region 可能是 ''），猜不到回傳 null
 * 文字裡有寫國家時，只採用那些國家的產區（例如「盧安達 基伍湖」不會變成剛果的基伍）；有好幾個時取最先出現的
 */
export function matchOrigin(...texts) {
  const found = findAliases(normalizeText(texts.filter(Boolean).join(' ')));
  if (!found.length) return null;
  const countries = new Set(found.filter((m) => !m.region).map((m) => m.country));
  const regions = found.filter((m) => m.region && (!countries.size || countries.has(m.country)));
  const first = (list) => list.reduce((a, b) => (b.start < a.start ? b : a));
  if (regions.length) {
    const r = first(regions);
    return { country: r.country, region: r.region };
  }
  return countries.size ? { country: first(found.filter((m) => !m.region)).country, region: '' } : null;
}

/** 豆子的產地：有選國家就用選的；沒有就從名稱和產地文字猜（guessed: true），猜不到回傳 null */
export function beanPlace(bean) {
  if (bean?.country) return { country: bean.country, region: bean.region || '', guessed: false };
  const m = matchOrigin(bean?.origin, bean?.name);
  return m ? { ...m, guessed: true } : null;
}

/** 顯示用的產地：選了的國家、產區（產地文字裡已經寫了就不重複）＋產地文字；只用選了的，不用猜的 */
export function originLabel(bean) {
  const text = String(bean?.origin ?? '').trim();
  const parts = [COUNTRY_BY_CODE.get(bean?.country)?.zh, REGION_BY_KEY.get(bean?.region)?.zh]
    .filter((p) => p && !text.includes(p));
  return [...parts, text].filter(Boolean).join(' ');
}

/* ===== 產地地圖的統計 ===== */

// 國家的顏色深淺：1–4 杯、5–14、15–39、40 以上（和熱度圖一樣用 --heat-1～4）
export const CUP_LEVELS = [1, 5, 15, 40];
export const cupLevel = (cups) => CUP_LEVELS.filter((n) => cups >= n).length;

const TOP_NOTES = 6;

function newBucket() {
  return { cups: 0, rated: 0, ratingSum: 0, notes: new Map(), beans: new Map() };
}
function addBrew(bucket, brew, bean) {
  bucket.cups++;
  if (brew.rating != null) {
    bucket.rated++;
    bucket.ratingSum += brew.rating;
  }
  for (const k of brew.flavorNotes ?? []) bucket.notes.set(k, (bucket.notes.get(k) ?? 0) + 1);
  const b = bucket.beans.get(bean.id) ?? { id: bean.id, name: bean.name, cups: 0, guessed: false };
  b.cups++;
  bucket.beans.set(bean.id, b);
}
function finish(bucket) {
  return {
    cups: bucket.cups,
    ratedCups: bucket.rated,
    avgRating: bucket.rated ? bucket.ratingSum / bucket.rated : null,
    // 最常選的風味：次數多→少，同次數依 key 排（結果固定）
    notes: [...bucket.notes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_NOTES)
      .map(([key, count]) => ({ key, count })),
    beans: [...bucket.beans.values()].sort((a, b) => b.cups - a.cups || a.name.localeCompare(b.name)),
  };
}

/**
 * 產地地圖：依豆子的產地（選的或猜的）把紀錄分到國家、產區
 * → { totalCups, countries: [{ code, cups, level, avgRating, ..., regions: [{ key, ... }], unassigned（有國家沒產區）}], unknown（猜不到產地的豆子）}
 * 國家、產區依杯數多→少；豆子帶 guessed（產地是猜的）
 */
export function summarizeOrigins(beans, brews) {
  const beanById = new Map(beans.map((b) => [b.id, b]));
  const places = new Map(beans.map((b) => [b.id, beanPlace(b)]));
  const countries = new Map();
  const unknown = newBucket();
  let totalCups = 0;
  for (const brew of brews) {
    const bean = beanById.get(brew.beanId);
    if (!bean) continue;
    totalCups++;
    const place = places.get(bean.id);
    if (!place || !COUNTRY_BY_CODE.has(place.country)) {
      addBrew(unknown, brew, bean);
      continue;
    }
    const c = countries.get(place.country) ?? { all: newBucket(), regions: new Map(), unassigned: newBucket() };
    countries.set(place.country, c);
    addBrew(c.all, brew, bean);
    const regionBucket = REGION_BY_KEY.get(place.region)?.country === place.country
      ? (c.regions.get(place.region) ?? c.regions.set(place.region, newBucket()).get(place.region))
      : c.unassigned;
    addBrew(regionBucket, brew, bean);
  }
  const markGuessed = (summary) => {
    for (const b of summary.beans) b.guessed = Boolean(places.get(b.id)?.guessed);
    return summary;
  };
  return {
    totalCups,
    countries: [...countries].map(([code, c]) => ({
      code,
      ...markGuessed(finish(c.all)),
      level: cupLevel(c.all.cups),
      regions: [...c.regions].map(([key, r]) => ({ key, ...markGuessed(finish(r)) })).sort((a, b) => b.cups - a.cups || a.key.localeCompare(b.key)),
      unassigned: markGuessed(finish(c.unassigned)),
    })).sort((a, b) => b.cups - a.cups || a.code.localeCompare(b.code)),
    unknown: finish(unknown),
  };
}
