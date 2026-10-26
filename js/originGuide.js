// 產地介紹（產地地圖的「認識產區」）：靜態內容，不 import 任何東西，Node 可直接測（origins-test 檢查 key、風味都對得上）
// 內容是一般常見的描述（查多個來源交叉比對後自己寫，不照抄），語氣用「常見」，不寫得太絕對；同一產區不同批次、處理法差很多
// altitude：大概的種植海拔（公尺）；processes：常見處理法（依常見程度）；flavors：常見風味，用風味輪的 key（js/flavorWheel.js），才能和自己的紀錄對照
// 用到才載入（models.loadOriginGuide）

// 處理法：比豆子表單的 PROCESS 多了「濕剝」（蘇門答臘的 Giling Basah）
export const GUIDE_PROCESS = { washed: '水洗', natural: '日曬', honey: '蜜處理', wethulled: '濕剝' };

// 國家：每個都有（origins-test 檢查和 js/origins.js 的 COUNTRIES 一致）
export const COUNTRY_GUIDE = {
  ET: {
    altitude: [1500, 2200], processes: ['washed', 'natural'],
    flavors: ['floral.floral.jasmine', 'fruity.citrus.lemon', 'fruity.berry.blueberry', 'floral.blacktea'],
    text: '咖啡的發源地，到現在森林裡還有野生的咖啡樹。品種多是當地原生種（常統稱 Heirloom），多由小農種植，再送到處理站。水洗常見花香、柑橘，日曬常見莓果。',
  },
  KE: {
    altitude: [1400, 2000], processes: ['washed'],
    flavors: ['fruity.berry.blackberry', 'fruity.citrus.grapefruit', 'sour.alcohol.winey', 'sweet.brownsugar'],
    text: '以合作社的水洗處理和 SL28、SL34 品種聞名，豆子依大小分成 AA、AB 等級。風味常有明亮多汁的酸質，像黑醋栗、莓果和葡萄柚。',
  },
  TZ: {
    altitude: [1200, 1900], processes: ['washed'],
    flavors: ['fruity.citrus', 'fruity.berry', 'nutty.cocoa.chocolate'],
    text: '主要產區在北部的吉力馬札羅山一帶和南部的姆貝亞。以水洗為主，圓豆（Peaberry）特別有名。風味常有明亮的酸質、柑橘與巧克力。',
  },
  RW: {
    altitude: [1400, 2000], processes: ['washed', 'natural'],
    flavors: ['floral.blacktea', 'fruity.citrus.orange', 'fruity.berry.raspberry'],
    text: '被稱為「千丘之國」，到處都是高地。小農把咖啡果實送到水洗處理站，品種多為波旁。常見紅茶、柑橘和紅色莓果，酸甜乾淨。',
  },
  BI: {
    altitude: [1400, 2000], processes: ['washed', 'natural'],
    flavors: ['fruity.berry.raspberry', 'fruity.citrus.orange', 'floral.blacktea'],
    text: '盧安達的鄰國，條件相近，也以波旁品種和水洗處理站為主。常見紅色莓果、柑橘和紅茶般的風味，口感細緻。',
  },
  UG: {
    altitude: [1300, 2300], processes: ['washed', 'natural'],
    flavors: ['nutty.cocoa.chocolate', 'sweet.brownsugar', 'fruity.dried'],
    text: '非洲重要的咖啡生產國，產量大多是羅布斯塔；精品阿拉比卡主要來自東邊的艾爾貢山和西邊的魯文佐里山。常見巧克力、紅糖與柔和的水果酸質。',
  },
  CD: {
    altitude: [1400, 2000], processes: ['washed'],
    flavors: ['fruity.berry', 'fruity.citrus', 'sweet.brownsugar'],
    text: '東部基伍湖西岸的高地條件很好，過去因為戰亂和交通困難較少出口，近年精品咖啡逐漸被看見。常見紅色水果、柑橘和甜感。',
  },
  YE: {
    altitude: [1500, 2500], processes: ['natural'],
    flavors: ['fruity.dried.raisin', 'sour.alcohol.winey', 'spices.brownspice', 'nutty.cocoa'],
    text: '最早出口咖啡的地方之一，「摩卡」這個名字就來自葉門的港口。咖啡種在乾燥山區的梯田上，傳統日曬，產量少、價格高。常見果乾、酒香、香料和可可。',
  },
  CO: {
    altitude: [1200, 2200], processes: ['washed', 'honey', 'natural'],
    flavors: ['fruity.citrus.orange', 'sweet.brownsugar.caramel', 'nutty.cocoa.chocolate'],
    text: '世界主要的阿拉比卡產地之一，安地斯山脈縱貫全國，不同地區在一年中不同時間收成。以水洗為主，常見柑橘、焦糖和巧克力，酸甜均衡；近年也有很多實驗性的發酵處理。',
  },
  PA: {
    altitude: [1200, 1900], processes: ['washed', 'natural'],
    flavors: ['floral.floral.jasmine', 'fruity.citrus', 'floral.blacktea', 'fruity.other.peach'],
    text: '產量不大，但因為藝伎（Geisha）成為世界知名的精品產地，產區集中在西部的巴魯火山周圍。常見茉莉花香、柑橘和紅茶般的風味。',
  },
  CR: {
    altitude: [1200, 1900], processes: ['washed', 'honey'],
    flavors: ['fruity.citrus', 'sweet.brownsugar.honey', 'nutty.cocoa.chocolate'],
    text: '很早就立法只種阿拉比卡，以許多小型的「微處理廠」聞名，蜜處理在這裡發展得很成熟。常見乾淨的柑橘酸質、蜂蜜般的甜感和巧克力。',
  },
  GT: {
    altitude: [1300, 2000], processes: ['washed'],
    flavors: ['nutty.cocoa.chocolate', 'sweet.brownsugar.caramel', 'spices.brownspice', 'fruity.citrus'],
    text: '火山多、微氣候多樣，劃分成好幾個各有特色的產區。以水洗為主，常見巧克力、焦糖、香料和柔和的柑橘酸質。',
  },
  HN: {
    altitude: [1100, 1800], processes: ['washed'],
    flavors: ['sweet.brownsugar.caramel', 'nutty.cocoa.chocolate', 'fruity.other'],
    text: '中美洲產量最大的國家，過去以商業豆為主，近年高海拔地區的精品豆品質提升很快。常見焦糖、巧克力與熟成水果般的甜感。',
  },
  SV: {
    altitude: [1000, 1800], processes: ['washed', 'honey', 'natural'],
    flavors: ['sweet.brownsugar.caramel', 'nutty.cocoa.chocolate', 'fruity.citrus'],
    text: '面積小但咖啡歷史悠久，保留了許多老波旁樹，帕卡斯（Pacas）和帕卡馬拉（Pacamara）品種都出自這裡。常見焦糖、巧克力和柔和的柑橘酸質。',
  },
  NI: {
    altitude: [1000, 1800], processes: ['washed'],
    flavors: ['sweet.brownsugar.caramel', 'nutty.cocoa.chocolate', 'nutty.nutty'],
    text: '北部的希諾特加、馬塔加爾帕、新塞哥維亞是主要產區，多為小農。常見焦糖、巧克力、堅果和溫和的酸質，口感圓潤。',
  },
  MX: {
    altitude: [900, 1800], processes: ['washed'],
    flavors: ['nutty.nutty', 'nutty.cocoa.chocolate', 'sweet.brownsugar.caramel'],
    text: '產區集中在南部的恰帕斯、瓦哈卡和韋拉克魯斯，有機認證的小農咖啡很多。常見堅果、巧克力和輕柔的酸質，口感清爽。',
  },
  JM: {
    altitude: [900, 1700], processes: ['washed'],
    flavors: ['nutty.nutty', 'nutty.cocoa.chocolate', 'sweet.overall'],
    text: '最有名的是藍山咖啡，有法定的產區和分級，大部分出口到日本。風味溫和均衡，常見堅果和巧克力。',
  },
  DO: {
    altitude: [600, 1500], processes: ['washed'],
    flavors: ['nutty.cocoa.chocolate', 'nutty.nutty', 'sweet.brownsugar.caramel'],
    text: '產區分散在各個山區，西南部的巴拉奧納最有名。常見巧克力、堅果和柔和的酸質，口感醇厚。',
  },
  BR: {
    altitude: [800, 1300], processes: ['natural', 'honey', 'washed'],
    flavors: ['nutty.nutty', 'nutty.cocoa.chocolate', 'sweet.brownsugar.caramel'],
    text: '世界最大的咖啡生產國。很多莊園地勢平坦、用機械採收，以日曬和半日曬（去果皮日曬，類似蜜處理）為主。常見堅果、巧克力和焦糖，酸質低，是義式配方的常客。',
  },
  PE: {
    altitude: [1200, 2000], processes: ['washed'],
    flavors: ['sweet.brownsugar.caramel', 'nutty.cocoa.chocolate', 'fruity.citrus'],
    text: '安地斯山區的小農咖啡，北部的卡哈馬卡等地產量最大，有機咖啡很多。常見焦糖、巧克力和溫和的柑橘酸質，乾淨順口。',
  },
  BO: {
    altitude: [1200, 2000], processes: ['washed', 'natural'],
    flavors: ['floral', 'fruity.citrus', 'sweet.brownsugar.caramel'],
    text: '產量很少，主要來自拉巴斯附近 Yungas 地區的卡拉納維，從高山一路延伸到亞馬遜邊緣。常見花香、柑橘與焦糖甜感，好的批次很細緻。',
  },
  EC: {
    altitude: [1200, 2000], processes: ['washed', 'natural'],
    flavors: ['floral', 'fruity.citrus', 'sweet.brownsugar'],
    text: '安地斯山兩側的高海拔產區，產量不大，近年南部的洛哈、北部的皮欽查在競賽中表現亮眼，也有人種藝伎。常見花香、柑橘與甜感。',
  },
  US: {
    altitude: [150, 900], processes: ['washed'],
    flavors: ['nutty.nutty', 'nutty.cocoa.chocolate', 'sweet.brownsugar'],
    text: '美國的咖啡主要來自夏威夷，最有名的是大島西側的可娜（Kona）。海拔不高，靠午後的雲層遮蔭。風味溫和，常見堅果、巧克力和柔和的甜感。',
  },
  ID: {
    altitude: [900, 1700], processes: ['wethulled', 'washed'],
    flavors: ['green.vegetative.herblike', 'spices', 'nutty.cocoa.darkchocolate'],
    text: '蘇門答臘、爪哇、蘇拉威西、峇里島都產咖啡，風格差很多。蘇門答臘常用濕剝法，口感厚實、低酸，帶草本、香料和黑巧克力；爪哇、峇里島多為水洗，比較乾淨。',
  },
  PG: {
    altitude: [1300, 1900], processes: ['washed'],
    flavors: ['fruity.other.pineapple', 'fruity.citrus', 'nutty.cocoa.chocolate'],
    text: '咖啡多來自東部、西部高地的小農庭園，和印尼的巴布亞在同一座島上。以水洗為主，常見熱帶水果、柑橘和巧克力，比印尼的咖啡乾淨明亮。',
  },
  TW: {
    altitude: [500, 1400], processes: ['washed', 'natural', 'honey'],
    flavors: ['floral.blacktea', 'sweet.brownsugar.honey', 'fruity.citrus'],
    text: '產量很少、價格偏高，主要來自嘉義阿里山、雲林古坑、南投和屏東，多是小農種植。處理法多元，常被形容乾淨、甜感好，帶茶感和柑橘、熱帶水果的風味。',
  },
  CN: {
    altitude: [1000, 1800], processes: ['washed', 'natural', 'honey'],
    flavors: ['nutty.nutty', 'sweet.brownsugar.caramel', 'fruity.citrus'],
    text: '中國的咖啡幾乎都來自雲南，普洱、保山、德宏是主要產區。過去以卡蒂姆（Catimor）商業豆為主，近年精品處理和品質進步很快。常見堅果、焦糖和溫和的水果酸質。',
  },
  IN: {
    altitude: [1000, 1500], processes: ['washed', 'natural'],
    flavors: ['spices', 'nutty.cocoa.chocolate', 'nutty.nutty'],
    text: '主要產區在南部的卡納塔克、喀拉拉、坦米爾納德，咖啡常和胡椒、豆蔻等香料一起種在遮蔭樹下。有名的「季風馬拉巴」是讓生豆吹季風受潮熟成。常見香料、巧克力，口感厚實、低酸。',
  },
  VN: {
    altitude: [1000, 1600], processes: ['washed', 'natural'],
    flavors: ['nutty.cocoa.chocolate', 'nutty.nutty', 'sweet.brownsugar'],
    text: '世界第二大的咖啡生產國，產量大多是羅布斯塔，種在中部高原；阿拉比卡主要來自大叻所在的林同省高地。常見巧克力、堅果與厚實的口感，近年精品阿拉比卡逐漸增加。',
  },
  TH: {
    altitude: [1000, 1500], processes: ['washed', 'natural', 'honey'],
    flavors: ['sweet.brownsugar.caramel', 'nutty.nutty', 'fruity.other'],
    text: '北部清萊、清邁山區的咖啡多由山地部落種植，不少是從替代鴉片的計畫發展起來的。常見焦糖、堅果和溫和的水果甜感。',
  },
  LA: {
    altitude: [1000, 1300], processes: ['washed', 'natural'],
    flavors: ['nutty.cocoa.chocolate', 'nutty.nutty', 'sweet.brownsugar'],
    text: '南部的波羅芬高原是火山台地，法國殖民時期開始種咖啡。產量大多是羅布斯塔；阿拉比卡常見巧克力、堅果與溫和的酸質。',
  },
  MM: {
    altitude: [1000, 1500], processes: ['washed', 'natural'],
    flavors: ['sweet.brownsugar', 'fruity.citrus', 'fruity.other'],
    text: '主要產區在東部的撣邦高原，2010 年代起在國際協助下發展精品咖啡，水洗、日曬都有。常見紅糖、柑橘和溫和的水果甜感。',
  },
};

// 產區的詳細介紹：先寫 20 個最常見的，其他的產區只顯示國家介紹和「詳細介紹之後補上」
// flavors 依處理法分開（key 必須在 processes 裡）
export const REGION_GUIDE = {
  'ET.yirgacheffe': {
    altitude: [1750, 2200], processes: ['washed', 'natural'],
    flavors: {
      washed: ['floral.floral.jasmine', 'fruity.citrus.lemon', 'floral.blacktea', 'fruity.other.peach'],
      natural: ['fruity.berry.blueberry', 'fruity.berry.strawberry', 'floral.floral.jasmine'],
    },
    text: '位在衣索比亞南部的 Gedeo 地區，小農把咖啡種在自家庭院和森林裡，品種多是當地原生種。水洗的耶加雪菲常被形容像茶一樣乾淨明亮，是很多人認識精品咖啡的第一支豆子。',
  },
  'ET.sidama': {
    altitude: [1500, 2200], processes: ['washed', 'natural'],
    flavors: {
      washed: ['fruity.citrus', 'floral.floral', 'sweet.brownsugar.honey'],
      natural: ['fruity.berry', 'fruity.other.grape', 'sweet.brownsugar'],
    },
    text: '衣索比亞產量最大的精品產區之一，範圍很廣，各地海拔、風土差異大；過去耶加雪菲、古吉也被歸在廣義的西達摩裡。近年 Bensa、Bombe 等高海拔地區的處理站很受注目。',
  },
  'ET.guji': {
    altitude: [1800, 2300], processes: ['natural', 'washed'],
    flavors: {
      natural: ['fruity.berry.strawberry', 'fruity.berry.blueberry', 'fruity.other.peach', 'sour.alcohol.winey'],
      washed: ['floral.floral.jasmine', 'fruity.other.peach', 'fruity.citrus.lemon'],
    },
    text: '在西達摩南方，過去常被歸在西達摩裡，近年獨立成為知名產區。Hambela、Shakiso 一帶海拔高，日曬豆常見濃郁的莓果與熱帶水果甜感。',
  },
  'ET.harrar': {
    altitude: [1400, 2100], processes: ['natural'],
    flavors: {
      natural: ['fruity.berry.blueberry', 'sour.alcohol.winey', 'nutty.cocoa.darkchocolate', 'spices'],
    },
    text: '位在衣索比亞東部高原，是歷史悠久的產區，氣候比南部乾燥，傳統以日曬為主。常被形容帶有藍莓、酒香和可可的厚實風味，風格比較狂野。',
  },
  'KE.nyeri': {
    altitude: [1500, 1900], processes: ['washed'],
    flavors: {
      washed: ['fruity.berry.blackberry', 'fruity.citrus.grapefruit', 'sour.alcohol.winey', 'sweet.brownsugar'],
    },
    text: '位在肯亞山西南側，火山土壤肥沃，咖啡多由合作社的處理廠水洗處理，品種以 SL28、SL34 為主。常見明亮多汁的酸質，像黑醋栗、黑莓和葡萄柚，甜感飽滿。',
  },
  'KE.kirinyaga': {
    altitude: [1500, 1900], processes: ['washed'],
    flavors: {
      washed: ['fruity.berry.blackberry', 'fruity.citrus', 'sweet.brownsugar', 'floral.blacktea'],
    },
    text: '在肯亞山南坡，和涅里相鄰，同樣以 SL28、SL34 和水洗處理為主。常見莓果、柑橘與紅糖般的甜感，口感飽滿多汁。',
  },
  'TZ.kilimanjaro': {
    altitude: [1300, 1800], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus.lemon', 'fruity.berry', 'nutty.cocoa.chocolate'],
    },
    text: '吉力馬札羅山南坡的火山土壤產區，靠近 Moshi 和 Arusha。和肯亞一樣多為水洗，酸質明亮但通常比肯亞柔和一點；這裡的圓豆（Peaberry）特別有名。',
  },
  'RW.western': {
    altitude: [1500, 2000], processes: ['washed', 'natural'],
    flavors: {
      washed: ['floral.blacktea', 'fruity.citrus.orange', 'fruity.berry.raspberry'],
      natural: ['fruity.berry.strawberry', 'sour.alcohol.winey', 'sweet.brownsugar'],
    },
    text: '位在基伍湖東岸，湖邊的高地雨量充足，咖啡多由小農送到水洗處理站。常見紅茶、柑橘、紅色莓果般乾淨的酸甜。偶爾會遇到「馬鈴薯味」的瑕疵豆（和一種蝽象有關），屬於個別狀況。',
  },
  'YE.haraz': {
    altitude: [1800, 2500], processes: ['natural'],
    flavors: {
      natural: ['fruity.dried.raisin', 'sour.alcohol.winey', 'spices.brownspice.cinnamon', 'nutty.cocoa.darkchocolate'],
    },
    text: 'Haraz 山區在首都沙那西邊，咖啡種在很高的梯田上，用傳統的日曬處理，產量少、價格高。常見果乾、酒香、香料和可可，風格獨特。',
  },
  'CO.huila': {
    altitude: [1300, 2000], processes: ['washed', 'honey', 'natural'],
    flavors: {
      washed: ['fruity.citrus.orange', 'fruity.other.apple', 'sweet.brownsugar.caramel', 'nutty.cocoa.chocolate'],
      honey: ['sweet.brownsugar.honey', 'fruity.other.peach', 'sweet.brownsugar.caramel'],
      natural: ['fruity.berry.strawberry', 'sour.alcohol.winey', 'fruity.other.pineapple'],
    },
    text: '哥倫比亞南部的安地斯山區，是哥倫比亞精品咖啡最知名的產區之一，Pitalito 一帶有很多得獎莊園。靠近赤道，一年常有兩次收成。常見柑橘、紅色水果與焦糖甜感，酸質明亮、口感圓潤。',
  },
  'CO.narino': {
    altitude: [1500, 2300], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus.orange', 'floral.floral', 'sweet.brownsugar.caramel', 'fruity.other.apple'],
    },
    text: '哥倫比亞最南端、靠近厄瓜多，咖啡種在很高的火山山谷裡，日夜溫差大、果實成熟得慢。常見明亮的柑橘酸質、花香與甜感，是哥倫比亞酸質最明亮的產區之一。',
  },
  'PA.boquete': {
    altitude: [1200, 1900], processes: ['washed', 'natural'],
    flavors: {
      washed: ['floral.floral.jasmine', 'floral.blacktea', 'fruity.citrus.lemon', 'fruity.other.peach'],
      natural: ['fruity.berry.strawberry', 'fruity.other.grape', 'floral.floral.jasmine', 'fruity.other.pineapple'],
    },
    text: '位在巴魯火山東側，霧氣和涼爽的氣候讓咖啡成熟得很慢。2004 年翡翠莊園（Hacienda La Esmeralda）的藝伎在比賽中一鳴驚人，讓這裡成為世界最貴的咖啡產區之一。藝伎常見茉莉花香、柑橘、紅茶和熱帶水果。',
  },
  'CR.tarrazu': {
    altitude: [1200, 1900], processes: ['washed', 'honey'],
    flavors: {
      washed: ['fruity.citrus.orange', 'nutty.cocoa.chocolate', 'sweet.brownsugar.caramel'],
      honey: ['sweet.brownsugar.honey', 'fruity.other.peach', 'fruity.dried'],
    },
    text: '哥斯大黎加最知名的產區，在首都聖荷西南方的山區。很多小農有自己的「微處理廠」，蜜處理很常見。常見乾淨的柑橘酸質、焦糖和巧克力，口感均衡。',
  },
  'GT.antigua': {
    altitude: [1500, 1700], processes: ['washed'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'sweet.brownsugar.caramel', 'spices.brownspice', 'fruity.citrus'],
    },
    text: '被三座火山環繞的谷地，火山灰土壤、日照充足，是瓜地馬拉最有名的傳統產區，很多咖啡種在遮蔭樹下。常見巧克力、焦糖、香料和柔和的柑橘酸質，口感飽滿。',
  },
  'GT.huehuetenango': {
    altitude: [1500, 2000], processes: ['washed'],
    flavors: {
      washed: ['fruity.other', 'fruity.citrus', 'floral.floral', 'nutty.cocoa.chocolate'],
    },
    text: '瓜地馬拉西北部、靠近墨西哥的高山產區，從墨西哥吹來的乾熱氣流讓高海拔也不容易結霜，所以咖啡可以種得很高。常見明亮的水果酸質、花香和巧克力。',
  },
  'BR.cerrado': {
    altitude: [800, 1300], processes: ['natural', 'honey'],
    flavors: {
      natural: ['nutty.nutty.peanuts', 'nutty.cocoa.chocolate', 'sweet.brownsugar.caramel'],
      honey: ['nutty.nutty.hazelnut', 'sweet.brownsugar.caramel', 'fruity.dried'],
    },
    text: '位在米納斯吉拉斯州的高原，乾季分明、地勢平坦，很多是大型莊園並用機械採收，是巴西第一個取得原產地標示的產區。常見堅果、巧克力和焦糖，酸質低、口感厚實，很適合做義式。',
  },
  'ID.mandheling': {
    altitude: [1100, 1600], processes: ['wethulled'],
    flavors: {
      wethulled: ['green.vegetative.herblike', 'spices', 'nutty.cocoa.darkchocolate', 'roasted.tobacco'],
    },
    text: '「曼特寧」原本是蘇門答臘一個民族（Mandailing）的名字，後來成了北蘇門答臘咖啡的通稱，產地多在多巴湖周邊。常用濕剝法（Giling Basah）處理，口感厚實、低酸，帶草本、香料和黑巧克力。',
  },
  'ID.gayo': {
    altitude: [1200, 1700], processes: ['wethulled', 'washed', 'natural'],
    flavors: {
      wethulled: ['green.vegetative.herblike', 'spices', 'nutty.cocoa.darkchocolate'],
      washed: ['fruity.citrus', 'sweet.brownsugar', 'spices'],
      natural: ['fruity.other.pineapple', 'sour.alcohol.winey', 'fruity.dried'],
    },
    text: '位在蘇門答臘最北端亞齊省的迦佑高地，以塔瓦湖周邊為中心。傳統也用濕剝法，口感厚實、帶香料與草本；近年也有水洗、日曬等處理，風格更乾淨。',
  },
  'JM.bluemountain': {
    altitude: [900, 1700], processes: ['washed'],
    flavors: {
      washed: ['nutty.nutty', 'nutty.cocoa.chocolate', 'sweet.overall', 'floral.floral'],
    },
    text: '牙買加東部的藍山山脈，只有在法定區域、一定海拔以上種出的咖啡才能叫「藍山」，產量少、價格高。以溫和均衡著稱，常見堅果、巧克力與柔和的酸質，沒有強烈的個性。',
  },
  'TW.alishan': {
    altitude: [900, 1400], processes: ['washed', 'natural', 'honey'],
    flavors: {
      washed: ['floral.blacktea', 'fruity.citrus', 'sweet.brownsugar.honey'],
      natural: ['fruity.other.pineapple', 'fruity.berry', 'sweet.brownsugar'],
      honey: ['sweet.brownsugar.honey', 'fruity.other.peach', 'floral.blacktea'],
    },
    text: '嘉義的阿里山鄉，咖啡常和茶園、檳榔園一起種在山坡上，多為小農，處理法很多元。常被形容乾淨、甜感好，帶有類似烏龍茶的茶感和柑橘、熱帶水果的風味。',
  },
};
