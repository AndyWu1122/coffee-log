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

  /* ----- 第一批補上（非洲、葉門） ----- */
  'ET.westarsi': {
    altitude: [1800, 2300], processes: ['washed', 'natural'],
    flavors: {
      washed: ['floral.floral.jasmine', 'fruity.other.peach', 'floral.blacktea', 'fruity.citrus.orange'],
      natural: ['fruity.berry.blueberry', 'fruity.berry.blackberry', 'floral.floral'],
    },
    text: '位在西達摩北邊的高原，Nensebo 一帶的處理站近年很受注目，品種多是當地原生種。水洗常見茉莉、水蜜桃和紅茶般的風味，日曬則偏藍莓、深色莓果和熱帶水果的甜感。',
  },
  'ET.limu': {
    altitude: [1500, 2100], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus', 'floral.floral.jasmine', 'fruity.other.peach', 'sweet.brownsugar.caramel'],
    },
    text: '在衣索比亞西南部、吉瑪附近，以水洗為主。「Limu」在市場上比較像一種風格的名稱，鄰近地區的豆子也常這樣標示。風味常被形容比南部產區溫和，帶柑橘、花香與焦糖般的甜感。',
  },
  'ET.jimma': {
    altitude: [1600, 2200], processes: ['natural', 'washed'],
    flavors: {
      natural: ['fruity.other.cherry', 'fruity.berry', 'nutty.cocoa.chocolate', 'floral.floral'],
      washed: ['fruity.citrus', 'fruity.other.peach', 'floral.blacktea', 'sweet.brownsugar.caramel'],
    },
    text: '衣索比亞西南部的大產區，過去以大量生產、品質普通的日曬豆為主；近年 Agaro 一帶的處理站開始做精緻的日曬與水洗，評價大幅提升。風格通常比南部產區均衡，花香與莓果沒那麼強烈。',
  },
  'ET.kaffa': {
    altitude: [1400, 2100], processes: ['natural'],
    flavors: {
      natural: ['nutty.cocoa.chocolate', 'spices.brownspice', 'fruity.berry'],
    },
    text: '衣索比亞西南部、常被稱為咖啡發源地的地區，至今還有大片野生咖啡森林，很多咖啡在森林裡半野生生長，以人工採收、日曬為主。風味常見可可、香料和溫和的果香，酸質比較柔和。',
  },
  'ET.lekempti': {
    altitude: [1700, 2200], processes: ['natural', 'washed'],
    flavors: {
      natural: ['fruity.other.peach', 'sweet.brownsugar.caramel', 'nutty.cocoa.chocolate'],
      washed: ['fruity.other.peach', 'fruity.citrus.lemon', 'floral.floral'],
    },
    text: '位在衣索比亞西部的 Wellega 地區，Lekempti 是當地城市 Nekemte 的舊名，傳統以日曬為主，豆子顆粒較大。果香常被形容比較溫和，比起莓果更偏向核果，口感中等，帶焦糖與巧克力的甜感。',
  },
  'KE.muranga': {
    altitude: [1500, 1900], processes: ['washed'],
    flavors: {
      washed: ['fruity.berry.blackberry', 'fruity.berry.raspberry', 'fruity.citrus', 'floral.floral'],
    },
    text: '位在肯亞山南側、涅里的南邊，由小農合作社的處理廠水洗處理，品種以 SL28、SL34 為主。常見黑醋栗、紅醋栗與柑橘的明亮酸質，也常帶花香，甜感乾淨。',
  },
  'KE.kiambu': {
    altitude: [1500, 2000], processes: ['washed'],
    flavors: {
      washed: ['fruity.berry.blackberry', 'fruity.citrus.grapefruit', 'floral.blacktea', 'spices'],
    },
    text: '位在首都奈洛比北邊，是肯亞歷史最久的產區之一，有很多大型莊園，肯亞的咖啡研究機構也在這裡。品種以 SL28、SL34 為主，常見黑醋栗、葡萄柚和紅茶般的風味，有時帶一點香料感。',
  },
  'KE.embu': {
    altitude: [1300, 1900], processes: ['washed'],
    flavors: {
      washed: ['fruity.berry.raspberry', 'fruity.berry.blackberry', 'fruity.citrus.lemon', 'sweet.brownsugar'],
    },
    text: '位在肯亞山東南側的坡地，紅色火山土壤，由小農合作社的處理廠水洗處理。風格明亮多汁，常見覆盆子、黑醋栗和檸檬；有些批次帶熱帶水果，或比較飽滿的可可調性。',
  },
  'TZ.mbeya': {
    altitude: [1400, 1900], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus.orange', 'fruity.other.cherry', 'nutty.cocoa.chocolate', 'sweet.brownsugar.caramel'],
    },
    text: '位在坦尚尼亞西南部的南部高地，靠近馬拉威和尚比亞，咖啡多由小農種植，經合作社和處理站水洗。近年品質進步很多，常見柑橘、櫻桃般的果香，搭配巧克力與焦糖的甜感，口感柔滑。',
  },
  'RW.southern': {
    altitude: [1600, 2000], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus.orange', 'fruity.other.cherry', 'floral.floral', 'sweet.brownsugar.caramel'],
    },
    text: '包含 Huye（舊稱 Butare）、Nyamagabe 等地，是盧安達最早發展精品水洗處理站的地區之一，比西部的基伍湖畔乾燥一些。品種以波旁為主，常見柳橙、櫻桃、花香和焦糖，乾淨甜美。',
  },
  'BI.kayanza': {
    altitude: [1600, 2100], processes: ['washed', 'natural'],
    flavors: {
      washed: ['floral.blacktea', 'fruity.berry', 'fruity.citrus.lemon', 'sweet.brownsugar.honey'],
      natural: ['fruity.berry.raspberry', 'fruity.other.peach', 'sweet.brownsugar.caramel'],
    },
    text: '位在蒲隆地北部、靠近盧安達邊境，是蒲隆地最知名的精品產區，小農把咖啡櫻桃送到處理站集中處理，品種以紅波旁為主。水洗常見紅茶、莓果與檸檬，日曬則有覆盆子、杏桃般的果甜。',
  },
  'BI.ngozi': {
    altitude: [1600, 1950], processes: ['washed', 'natural'],
    flavors: {
      washed: ['fruity.other.cherry', 'fruity.citrus', 'floral.blacktea', 'nutty.cocoa.chocolate'],
      natural: ['fruity.berry.blueberry', 'sweet.vanilla', 'fruity.other.pear', 'sweet.brownsugar'],
    },
    text: '在卡揚扎東邊，同樣是蒲隆地北部的高海拔產區，處理站常用兩段發酵的水洗法，酸質明亮。品種以紅波旁為主，水洗常見櫻桃、柑橘與紅茶，日曬則偏藍莓果醬、香草和西洋梨的甜感。',
  },
  'UG.elgon': {
    altitude: [1500, 2200], processes: ['washed', 'natural'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'fruity.berry', 'fruity.citrus', 'fruity.other.grape'],
      natural: ['fruity.dried.prune', 'fruity.dried.raisin', 'nutty.cocoa'],
    },
    text: '位在烏干達東部、和肯亞交界的艾爾貢山西坡，市場上常以 Bugisu 或 Sipi Falls 的名字出現，是烏干達最主要的阿拉比卡產區。水洗常見莓果、柑橘的酸質和巧克力的基調，口感厚實。',
  },
  'UG.rwenzori': {
    altitude: [1500, 2200], processes: ['natural', 'washed'],
    flavors: {
      natural: ['fruity.other.peach', 'fruity.berry', 'nutty.cocoa.chocolate', 'sour.alcohol.winey'],
      washed: ['fruity.berry.blackberry', 'floral.blacktea', 'fruity.dried.prune', 'nutty.nutty'],
    },
    text: '位在烏干達西部、和剛果交界的魯文佐里山，咖啡多種在香蕉樹下，由小農合作社收購。近年日曬和延長發酵的批次越來越多，常見核果、紅色水果與巧克力；水洗則偏黑醋栗、紅茶和果乾。',
  },
  'CD.kivu': {
    altitude: [1450, 2200], processes: ['washed'],
    flavors: {
      washed: ['fruity.berry', 'fruity.citrus.orange', 'sweet.brownsugar.caramel', 'spices.brownspice.cinnamon'],
    },
    text: '位在剛果東部、基伍湖西岸和湖中的島上，火山土壤，和湖對岸的盧安達風土相近。過去因戰亂很難出口，近年靠合作社重新發展水洗精品豆，常見紅色莓果、柑橘、焦糖，以及肉桂般的香料感。',
  },
  'YE.banimatar': {
    altitude: [1800, 2400], processes: ['natural'],
    flavors: {
      natural: ['fruity.other.grape', 'fruity.dried.prune', 'roasted.tobacco', 'nutty.cocoa', 'spices'],
    },
    text: '在首都沙那西邊的山區，「Matari」是葉門最有名的咖啡之一，咖啡種在山坡的梯田上，傳統以日曬處理。常見葡萄般的酸質、黑棗乾、菸草和可可，風格厚重、帶香料感；近年也有花香、核果調性的微批次。',
  },

  /* ----- 第二批補上（中美洲、加勒比海） ----- */
  'PA.volcan': {
    altitude: [1400, 2000], processes: ['washed', 'natural'],
    flavors: {
      washed: ['floral.floral.jasmine', 'fruity.citrus', 'floral.blacktea', 'fruity.other.peach'],
      natural: ['fruity.berry', 'fruity.citrus.lime', 'floral.blacktea', 'sour.alcohol.winey'],
    },
    text: '在巴魯火山西側，和波奎特隔著火山相望，部分莊園海拔比波奎特更高，近年也出了不少知名的藝伎莊園。水洗的藝伎常見茉莉、柑橘和佛手柑般的茶感，日曬則偏紅色莓果與酒香。',
  },
  'CR.westvalley': {
    altitude: [1200, 1800], processes: ['honey', 'washed'],
    flavors: {
      honey: ['fruity.other.cherry', 'fruity.berry.raspberry', 'fruity.other.grape', 'sweet.brownsugar.caramel'],
      washed: ['fruity.citrus', 'fruity.other.peach', 'sweet.brownsugar.honey'],
    },
    text: '在首都聖荷西西北邊的 Naranjo、Sarchí 一帶，是哥斯大黎加微型處理廠最集中的產區之一，蜜處理特別盛行，Villa Sarchí 品種也是在這裡發現的。常見櫻桃、紅色莓果、葡萄和焦糖般的甜感，口感圓潤。',
  },
  'CR.centralvalley': {
    altitude: [1200, 1600], processes: ['washed', 'honey'],
    flavors: {
      washed: ['fruity.citrus.orange', 'fruity.citrus.lemon', 'floral.floral', 'nutty.cocoa.chocolate'],
      honey: ['sweet.brownsugar.honey', 'fruity.other.peach', 'nutty.cocoa'],
    },
    text: '圍繞首都聖荷西，在 Poás、Barva、Irazú 等火山的坡地上，是哥斯大黎加最早開始種咖啡的地方，火山土壤肥沃。常見柳橙、檸檬等柑橘的乾淨酸質和花香，口感均衡，也常帶巧克力般的甜感。',
  },
  'GT.atitlan': {
    altitude: [1500, 2000], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus', 'floral.floral', 'nutty.cocoa.chocolate', 'spices.brownspice.cinnamon'],
    },
    text: '圍繞阿提特蘭湖，湖邊有三座火山，在瓜地馬拉的火山產區裡土壤的有機質最豐富，湖面吹來的風和雲霧影響當地的微氣候。咖啡多由小農種植，常見明亮的柑橘酸質、花香，以及巧克力和肉桂般的香料感，口感飽滿。',
  },
  'GT.acatenango': {
    altitude: [1500, 2000], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus.orange', 'floral.floral', 'sweet.brownsugar.caramel', 'spices.brownspice'],
    },
    text: '在安提瓜西邊、阿卡特南果火山的坡地上，附近的富埃戈火山經常噴發，火山灰為土壤補充礦物質；咖啡多種在濃密的遮蔭樹下，在穩定的風中曬乾。常見明亮有結構的酸質、柳橙和花香，甜感乾淨。',
  },
  'HN.santabarbara': {
    altitude: [1300, 1800], processes: ['washed'],
    flavors: {
      washed: ['fruity.other.apple', 'fruity.other.peach', 'fruity.citrus.lime', 'nutty.cocoa.darkchocolate'],
    },
    text: '位在宏都拉斯西部，聖塔芭芭拉山周圍的小農莊園常在卓越杯拿下好成績，主要品種是當地常見的帕卡斯（Pacas）。常見蘋果、水蜜桃、萊姆般的果香和熱帶水果，搭配黑巧克力的甜感，風味豐富。',
  },
  'HN.marcala': {
    altitude: [1300, 1700], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus.orange', 'fruity.other.peach', 'sweet.brownsugar.caramel', 'spices'],
    },
    text: '位在宏都拉斯西南部的 La Paz 一帶，2005 年取得中美洲第一個咖啡的原產地名稱保護（DO Marcala），範圍橫跨三個省。常見柳橙、水蜜桃的酸質，以及焦糖和一點香料感的甜，口感乾淨滑順。',
  },
  'HN.copan': {
    altitude: [1000, 1600], processes: ['washed'],
    flavors: {
      washed: ['fruity.other.apple', 'fruity.citrus.orange', 'sweet.brownsugar.caramel', 'nutty.cocoa.chocolate'],
    },
    text: '位在宏都拉斯西部、靠近瓜地馬拉邊境，著名的馬雅古城科潘就在這裡；咖啡多種在遮蔭樹下，屬於「宏都拉斯西部咖啡」（HWC）地理標示的範圍。常見蘋果、柑橘的果香和焦糖、巧克力的甜感，口感飽滿。',
  },
  'SV.apaneca': {
    altitude: [1100, 1900], processes: ['washed', 'natural'],
    flavors: {
      washed: ['sweet.brownsugar.caramel', 'nutty.cocoa.darkchocolate', 'fruity.citrus', 'floral.floral'],
      natural: ['fruity.berry.blackberry', 'fruity.dried', 'fruity.other.grape'],
    },
    text: '從聖安娜火山延伸到阿帕內卡的山脈，是薩爾瓦多最大的產區，火山土壤肥沃。傳統以波旁為主，常見焦糖、黑巧克力與柔和的果香；在薩爾瓦多培育的帕卡馬拉（Pacamara）顆粒很大，風味比較明亮，帶花香和柑橘。',
  },
  'NI.jinotega': {
    altitude: [1100, 1700], processes: ['washed', 'natural'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'nutty.nutty.hazelnut', 'sweet.brownsugar.honey', 'floral.floral'],
      natural: ['fruity.berry.strawberry', 'fruity.other.grape', 'fruity.berry.blueberry', 'nutty.cocoa.chocolate'],
    },
    text: '位在尼加拉瓜北部的高地，是尼加拉瓜產量最大的產區，咖啡多由小農種植。水洗常見巧克力、榛果和蜂蜜般的甜感，口感圓潤；近年也有日曬的批次，帶草莓、葡萄和莓果的果香。',
  },
  'NI.nuevasegovia': {
    altitude: [1100, 1700], processes: ['washed'],
    flavors: {
      washed: ['floral.floral.jasmine', 'fruity.other.peach', 'floral.blacktea', 'fruity.citrus.grapefruit', 'sweet.brownsugar'],
    },
    text: '位在尼加拉瓜最北邊、和宏都拉斯交界，Dipilto 一帶的山區海拔較高，常在卓越杯拿下好成績。風味常見茉莉、水蜜桃、紅茶和葡萄柚，甜感像紅糖，是尼加拉瓜風味最明亮的產區之一。',
  },
  'NI.matagalpa': {
    altitude: [900, 1400], processes: ['washed'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'nutty.nutty', 'sweet.brownsugar.caramel', 'fruity.other.apple'],
    },
    text: '在希諾特加南邊，是尼加拉瓜咖啡歷史最久的產區之一，十九世紀就有德國等地的移民來開墾咖啡莊園。風味常被形容溫和、酸質偏低，帶牛奶巧克力、核桃和焦糖；海拔較高的批次則有蘋果、熱帶水果的果香。',
  },
  'MX.chiapas': {
    altitude: [1000, 1800], processes: ['washed'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'nutty.nutty.almond', 'fruity.other.pear', 'fruity.citrus.orange'],
    },
    text: '位在墨西哥最南端、和瓜地馬拉交界，是墨西哥產量最大的咖啡州；南部的 Soconusco 一帶多是在森林遮蔭下種植的小農，有機咖啡很多。常見牛奶巧克力、杏仁、西洋梨和柑橘，口感柔和。',
  },
  'MX.oaxaca': {
    altitude: [1300, 1800], processes: ['washed'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'fruity.citrus.lemon', 'fruity.other.cherry', 'floral.floral.chamomile'],
    },
    text: '位在墨西哥南部，咖啡多由原住民小農種在山區，Pluma Hidalgo 一帶有當地鐵比卡變種、同名的「Pluma Hidalgo」品種。常見可可、檸檬、李子與櫻桃般的果香，偶爾帶洋甘菊的花香，酸質細緻。',
  },
  'MX.veracruz': {
    altitude: [1100, 1600], processes: ['washed'],
    flavors: {
      washed: ['sweet.brownsugar', 'nutty.nutty', 'fruity.citrus.orange', 'nutty.cocoa.chocolate'],
    },
    text: '位在墨西哥東部、面向墨西哥灣，Coatepec 一帶在 Cofre de Perote 火山的坡地上，是墨西哥歷史悠久的咖啡產區。常見紅糖、堅果和柳橙皮般的風味，酸質圓潤、帶巧克力的甜感；海拔高的批次則有水果和花香。',
  },
  'DO.barahona': {
    altitude: [600, 1300], processes: ['washed'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'fruity.dried', 'fruity.citrus.orange', 'roasted.tobacco'],
    },
    text: '位在多明尼加西南部的山區、靠近海地邊境，是多明尼加最知名的產區，有原產地名稱保護。比起國內其他產區，酸質較明亮、口感較厚實，常見巧克力、果乾和糖漬橙皮，有時帶一點菸草感。',
  },

  /* ----- 第三批補上（南美洲） ----- */
  'CO.cauca': {
    altitude: [1700, 2100], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus.orange', 'floral.floral', 'sweet.brownsugar', 'spices.brownspice.anise'],
    },
    text: '位在哥倫比亞西南部，Inzá、Popayán 一帶靠近 Puracé 火山，很多農場在海拔 2,000 公尺上下，日夜溫差大。咖啡多由小農自己發酵、水洗，常見柳橙、花香和紅糖般的甜感，有時帶八角般的香料感，酸質明亮。',
  },
  'CO.tolima': {
    altitude: [1500, 2000], processes: ['washed'],
    flavors: {
      washed: ['sweet.brownsugar.caramel', 'nutty.cocoa.chocolate', 'fruity.berry', 'fruity.citrus.orange'],
    },
    text: '位在哥倫比亞中部，南部的 Planadas 一帶過去因內戰對外封閉，近年靠小農合作社的精品咖啡打出名號，常在比賽拿到好成績。咖啡多種在遮蔭下、成熟得慢，常見焦糖、巧克力的甜感和莓果、柑橘的果香。',
  },
  'CO.antioquia': {
    altitude: [1300, 1900], processes: ['washed'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'sweet.brownsugar.caramel', 'nutty.nutty', 'fruity.citrus'],
    },
    text: '以麥德林為中心的大產區，是哥倫比亞歷史悠久、產量很大的咖啡省份，咖啡多種在陡峭的山谷裡，以水洗為主。常見牛奶巧克力、焦糖、紅糖和核桃，口感中等，比較不走水果和酒香；海拔高的批次會帶柑橘與紅色水果。',
  },
  'CO.quindio': {
    altitude: [1400, 1800], processes: ['washed'],
    flavors: {
      washed: ['fruity.berry.strawberry', 'fruity.other.peach', 'sweet.brownsugar.caramel', 'sour.alcohol.fermented'],
    },
    text: '位在哥倫比亞「咖啡文化景觀區」（咖啡軸心）的中央，是面積最小的產咖啡省份之一，觀光咖啡莊園很多。近年這裡的農場以厭氧、二氧化碳浸漬、加入水果共同發酵等實驗性處理聞名，常見草莓、葡萄、水蜜桃等很強烈的果香。',
  },
  'BR.suldeminas': {
    altitude: [900, 1300], processes: ['natural', 'honey'],
    flavors: {
      natural: ['nutty.cocoa.chocolate', 'nutty.nutty', 'sweet.brownsugar.caramel', 'roasted.cereal.malt'],
      honey: ['nutty.cocoa.chocolate', 'sweet.brownsugar.honey', 'nutty.nutty', 'fruity.citrus.orange'],
    },
    text: '位在米納斯吉拉斯州南部，是巴西最大、歷史最久的咖啡產區之一，丘陵起伏，很多農場用機器採收。以日曬和去皮日曬（巴西的蜜處理）為主，常見巧克力、堅果、焦糖和麥芽，酸質低、口感厚實；海拔較高的批次帶柑橘與核果。',
  },
  'BR.mogiana': {
    altitude: [900, 1200], processes: ['natural'],
    flavors: {
      natural: ['nutty.cocoa.chocolate', 'nutty.nutty.hazelnut', 'sweet.brownsugar.caramel', 'fruity.other.cherry'],
    },
    text: '在聖保羅州和米納斯吉拉斯州交界，北邊的 Alta Mogiana 海拔較高、氣溫穩定，是巴西老牌的精品產區。以日曬為主，品種多是 Catuaí 和 Mundo Novo，常見巧克力、榛果、焦糖的甜感，以及櫻桃般的柔和果香。',
  },
  'BR.chapada': {
    altitude: [1100, 1400], processes: ['natural', 'honey'],
    flavors: {
      natural: ['fruity.other.peach', 'fruity.berry', 'floral.floral', 'sweet.brownsugar.maple'],
      honey: ['fruity.citrus.orange', 'fruity.other.peach', 'sweet.brownsugar.honey', 'spices.brownspice'],
    },
    text: '位在巴西東北部巴伊亞州的高原，Piatã 一帶海拔約 1,300 公尺，是東北部海拔最高的小鎮之一，冬天夜裡很冷。近年常在巴西的卓越杯拿下好成績，風格和南部產區不同，酸質明亮乾淨，常見花香、柑橘、核果和莓果。',
  },
  'PE.cajamarca': {
    altitude: [1500, 2000], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus.orange', 'fruity.other.cherry', 'floral.floral', 'nutty.cocoa.chocolate'],
    },
    text: '位在秘魯北部，Jaén、San Ignacio 一帶是秘魯產量最大的產區之一，合作社和有機咖啡很多。San Ignacio 的豆子常被形容果香、花香較多，帶巧克力和堅果；比較溫暖的 Jaén 則偏柳橙、橘子般的柑橘調性。',
  },
  'PE.junin': {
    altitude: [1200, 1800], processes: ['washed'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'sweet.brownsugar.honey', 'fruity.other.apple', 'nutty.nutty'],
    },
    text: '位在秘魯中部，咖啡主要種在 Chanchamayo 和 Satipo 兩個省的「高地叢林」，也是秘魯主要的產區之一。常見可可、蜂蜜、蘋果和堅果，口感圓潤、酸質柔和；高海拔的得獎批次則有紅色莓果和柑橘。',
  },
  'PE.cusco': {
    altitude: [1400, 2100], processes: ['washed'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'sweet.brownsugar.caramel', 'spices.brownspice', 'fruity.citrus.orange'],
    },
    text: '位在秘魯南部，咖啡主要種在 La Convención 省 Quillabamba 一帶的山谷，多在遮蔭下種植，品種以鐵比卡、波旁為主。風味常被形容輕盈有結構，帶牛奶巧克力、焦糖和香料；高海拔的批次有柳橙、紅茶和熱帶水果。',
  },
  'PE.puno': {
    altitude: [1500, 1900], processes: ['washed'],
    flavors: {
      washed: ['floral.blacktea', 'fruity.citrus.lemon', 'fruity.other.grape', 'nutty.cocoa.chocolate'],
    },
    text: '位在秘魯東南部、靠近玻利維亞，咖啡多種在 Sandia 一帶、亞馬遜雨林邊緣的山谷，由合作社集中處理，品種多是波旁、鐵比卡。常見紅茶、檸檬皮和紅葡萄，也有巧克力和焦糖的甜感，酸質柔和。',
  },
  'BO.caranavi': {
    altitude: [1400, 1800], processes: ['washed', 'natural'],
    flavors: {
      washed: ['fruity.citrus', 'fruity.other.peach', 'floral.floral', 'nutty.cocoa'],
      natural: ['fruity.dried', 'fruity.other.cherry', 'spices.brownspice'],
    },
    text: '位在玻利維亞 La Paz 省的 Yungas 山區，地形陡峭潮濕，森林覆蓋大部分土地，玻利維亞大部分的精品咖啡都產自這裡。水洗常見柑橘、黃桃、白花和可可，日曬則偏果乾、黑櫻桃和香料感。',
  },
  'EC.loja': {
    altitude: [1500, 2200], processes: ['washed'],
    flavors: {
      washed: ['fruity.other.peach', 'fruity.citrus.lime', 'floral.floral', 'sweet.brownsugar.honey'],
    },
    text: '位在厄瓜多南部的安地斯山區，靠近秘魯邊境，Vilcabamba、Quilanga 一帶有不少高海拔的小農場，品種常見 Typica Mejorado。常見杏桃、水蜜桃、萊姆和白花，搭配蜂蜜般的甜感，風格乾淨明亮。',
  },
  'EC.pichincha': {
    altitude: [1100, 1800], processes: ['washed'],
    flavors: {
      washed: ['fruity.other.apple', 'fruity.citrus.grapefruit', 'floral.blacktea', 'sweet.brownsugar'],
    },
    text: '位在首都基多周圍，Nanegal 等西北邊的雲霧森林山谷比基多溫暖潮濕，有不少知名的小莊園，Sidra 等品種也常在這一帶出現。常見蘋果、葡萄柚、石榴與紅茶般的風味，甜感像紅糖，酸質明亮。',
  },

  /* ----- 第四批補上（亞洲、太平洋） ----- */
  'US.kona': {
    altitude: [250, 900], processes: ['washed'],
    flavors: {
      washed: ['fruity.other.peach', 'fruity.citrus', 'floral.floral', 'nutty.nutty', 'sweet.brownsugar'],
    },
    text: '夏威夷大島西岸 Hualālai 和 Mauna Loa 火山的山坡，下午常有雲層遮蔭，只有這一帶種的咖啡才能叫「Kona」，品種以鐵比卡為主。常見水蜜桃、柑橘、花香和夏威夷豆般的堅果感，甜感像紅糖，口感柔和乾淨。',
  },
  'ID.java': {
    altitude: [1100, 1600], processes: ['washed'],
    flavors: {
      washed: ['floral.blacktea', 'nutty.cocoa.chocolate', 'nutty.nutty', 'spices.brownspice'],
    },
    text: '爪哇是荷蘭人在 17 世紀末最早大規模種咖啡的地方之一，「Java」後來也成了咖啡的代稱。東爪哇的 Ijen 高原有大片火山土壤的老莊園，和蘇門答臘不同，多為水洗，常見紅茶般的口感、可可、堅果和香料，酸質柔和乾淨。',
  },
  'ID.toraja': {
    altitude: [1200, 1900], processes: ['wethulled', 'washed'],
    flavors: {
      wethulled: ['spices', 'nutty.cocoa.darkchocolate', 'green.vegetative.herblike'],
      washed: ['fruity.citrus', 'floral.blacktea', 'nutty.cocoa.chocolate'],
    },
    text: '位在蘇拉威西島中部的山區，以 Toraja 族的船形屋聞名，咖啡多由小農種植。傳統的濕剝處理口感厚重、酸質低，常見泥土、香料、黑巧克力和草本的風味；水洗的批次則比較乾淨明亮，帶柑橘和紅茶感。',
  },
  'ID.bali': {
    altitude: [1200, 1600], processes: ['natural'],
    flavors: {
      natural: ['fruity.citrus', 'fruity.other.cherry', 'fruity.berry.strawberry', 'nutty.cocoa.chocolate'],
    },
    text: '位在峇里島北部的 Kintamani 高原，火山坡上的咖啡常和柑橘樹一起種，小農以傳統的 Subak Abian 組織合作管理。近年以日曬為主，常見柑橘、櫻桃、草莓與巧克力，比蘇門答臘的豆子輕盈明亮。',
  },
  'PG.easternhighlands': {
    altitude: [1500, 2000], processes: ['washed'],
    flavors: {
      washed: ['sweet.brownsugar', 'fruity.berry', 'fruity.citrus', 'floral.floral'],
    },
    text: '位在巴布亞紐幾內亞中部的高地，Goroka 一帶是當地咖啡的中心，咖啡多由小農在自家園子種植，品種多是鐵比卡和 Arusha。常見紅糖、紅色莓果、柑橘和花香，酸質柔和、甜感好。',
  },
  'PG.westernhighlands': {
    altitude: [1400, 1800], processes: ['washed'],
    flavors: {
      washed: ['fruity.citrus', 'nutty.cocoa.chocolate', 'nutty.nutty', 'spices.brownspice.nutmeg'],
    },
    text: '以 Mount Hagen 和 Wahgi 河谷為中心，除了小農，也有 Sigri 這樣歷史悠久的大莊園，品種多是鐵比卡和 Arusha。常見柑橘、黑李、巧克力和堅果，偶爾帶肉豆蔻般的香料感，口感滑順。',
  },
  'TW.gukeng': {
    altitude: [200, 800], processes: ['washed'],
    flavors: {
      washed: ['nutty.nutty', 'sweet.brownsugar', 'floral.blacktea', 'nutty.cocoa'],
    },
    text: '雲林的古坑，以華山一帶最有名，日治時期就有大規模的咖啡農場，戰後一度荒廢，1990 年代以後才重新興起，咖啡常和檳榔、果樹混種在山坡上。風味常被形容溫和、酸質低，帶堅果、紅糖和茶感。',
  },
  'TW.nantou': {
    altitude: [500, 1500], processes: ['washed', 'natural', 'honey'],
    flavors: {
      washed: ['floral.blacktea', 'fruity.citrus', 'sweet.brownsugar.honey'],
      natural: ['fruity.berry', 'fruity.other.pineapple', 'sweet.brownsugar'],
      honey: ['sweet.brownsugar.honey', 'fruity.other.peach', 'floral.blacktea'],
    },
    text: '國姓、仁愛、魚池、信義等鄉鎮都有種咖啡，921 地震後國姓很多農民改種咖啡。各地海拔和處理法差異很大，常被形容溫潤回甘；高海拔的批次帶花果香和明亮的酸質。',
  },
  'TW.pingtung': {
    altitude: [300, 1000], processes: ['washed'],
    flavors: {
      washed: ['floral.floral', 'fruity', 'sweet.brownsugar.honey', 'nutty.nutty'],
    },
    text: '大武山下的泰武、三地門、瑪家一帶，多由排灣族、魯凱族的小農種植，品種多是鐵比卡，日照強、日夜溫差大。淺焙常見花香、果香和蜂蜜般的甜感，口感溫和回甘、酸度中等。',
  },
  'CN.puer': {
    altitude: [1300, 1700], processes: ['washed', 'natural', 'honey'],
    flavors: {
      washed: ['floral.blacktea', 'fruity.other.apple', 'fruity.berry'],
      natural: ['fruity.other.cherry', 'fruity.other.pear', 'nutty.cocoa.chocolate'],
      honey: ['fruity.citrus.orange', 'sweet.vanilla', 'roasted.cereal'],
    },
    text: '位在雲南南部，是中國咖啡產量最大的地區，品種多是卡蒂姆（Catimor），過去多做商業豆，近年處理法越來越講究。水洗常見茶感、蘋果和莓果，蜜處理有柳橙和香草般的甜，日曬則偏黑櫻桃、西洋梨和巧克力。',
  },
  'CN.baoshan': {
    altitude: [1300, 1800], processes: ['washed', 'natural'],
    flavors: {
      washed: ['fruity.dried', 'nutty.cocoa', 'fruity.citrus.orange', 'floral.blacktea'],
      natural: ['fruity.berry', 'sour.alcohol.winey', 'nutty.cocoa.chocolate'],
    },
    text: '位在雲南西部，怒江河谷的潞江壩是雲南很早開始種咖啡的地區之一，「保山小粒咖啡」有中國和歐盟的地理標誌保護，除了卡蒂姆也有少量鐵比卡。常見紅棗、可可、柳橙和茶感，日曬與發酵的批次則有莓果和酒香。',
  },
  'CN.dehong': {
    altitude: [1300, 1700], processes: ['honey', 'washed'],
    flavors: {
      honey: ['fruity.other.peach', 'floral.blacktea', 'sweet.brownsugar.caramel'],
      washed: ['fruity.other.peach', 'floral.floral.rose', 'floral.blacktea'],
    },
    text: '位在雲南西部、和緬甸交界，芒市一帶是雲南的咖啡重鎮，品種以卡蒂姆為主。近年蜜處理和酵母發酵的批次越來越多，常見水蜜桃、荔枝和像烏龍茶的茶感，甜感明顯、苦味低。',
  },
  'IN.chikmagalur': {
    altitude: [1000, 1500], processes: ['washed', 'natural'],
    flavors: {
      washed: ['nutty.cocoa.chocolate', 'nutty.nutty', 'sweet.brownsugar.caramel', 'spices'],
      natural: ['nutty.cocoa.chocolate', 'nutty.nutty', 'sweet.brownsugar'],
    },
    text: '位在印度西南部的卡納塔克邦，相傳 17 世紀蘇非聖人 Baba Budan 從葉門帶了 7 顆咖啡種子種在這裡的山上，是印度咖啡的起點。咖啡多在遮蔭下和胡椒、小豆蔻混種，常見巧克力、堅果、焦糖與香料感，酸質低、口感厚實。',
  },
  'VN.dalat': {
    altitude: [1400, 1600], processes: ['washed', 'honey'],
    flavors: {
      washed: ['fruity.other.peach', 'fruity.other.apple', 'nutty.cocoa.chocolate'],
      honey: ['fruity.citrus.orange', 'fruity.other.pineapple', 'floral.floral'],
    },
    text: '位在越南中南部的林同省高原，越南大部分是羅布斯塔，大叻周圍的 Cầu Đất 一帶則因為涼爽、海拔高，是阿拉比卡的主要產區，19 世紀由法國人引進。常見水蜜桃、青蘋果和牛奶巧克力；蜜處理則偏柳橙、鳳梨與白花。',
  },
  'TH.chiangrai': {
    altitude: [1200, 1500], processes: ['honey', 'natural'],
    flavors: {
      honey: ['fruity.other.pineapple', 'sweet.brownsugar.honey', 'floral.blacktea'],
      natural: ['fruity.other.apple', 'fruity.other.peach', 'sweet.brownsugar.caramel'],
    },
    text: '位在泰國最北部，Doi Chang、Doi Tung 一帶的山區原本種罌粟，透過皇室計畫改種咖啡，現在是泰國阿拉比卡的主要產區，多由山地部落的小農種植。蜜處理常見龍眼、鳳梨和蜂蜜，日曬則有蘋果、杏桃和熱帶水果。',
  },
  'TH.chiangmai': {
    altitude: [1000, 1300], processes: ['washed'],
    flavors: {
      washed: ['floral.blacktea', 'fruity.citrus.lemon', 'nutty.cocoa.darkchocolate', 'sweet.brownsugar.molasses'],
    },
    text: '在清萊南邊，咖啡多種在山地部落周圍的森林裡，和清萊一樣是皇室計畫推動、用來取代罌粟的作物，多由合作社處理。水洗常見綠茶、檸檬、柚子般的清爽酸質，接著是黑巧克力和糖蜜的甜，有時帶香料感。',
  },
  'LA.bolaven': {
    altitude: [1000, 1300], processes: ['washed'],
    flavors: {
      washed: ['floral.blacktea', 'sweet.brownsugar', 'nutty.nutty', 'fruity.other.peach'],
    },
    text: '位在寮國南部，Paksong 一帶的火山高原涼爽多雨，20 世紀初由法國人引進咖啡，現在除了羅布斯塔也有不少阿拉比卡。水洗常見花草茶般的口感、紅糖和核桃，風格溫和、酸質低，好的批次帶水蜜桃與柑橘。',
  },
  'MM.shan': {
    altitude: [1100, 1600], processes: ['natural', 'washed'],
    flavors: {
      natural: ['fruity.berry.strawberry', 'fruity.other.grape', 'sour.alcohol.winey', 'nutty.cocoa.chocolate'],
      washed: ['nutty.cocoa.chocolate', 'roasted.cereal.malt', 'floral.floral'],
    },
    text: '位在緬甸東部的高原，Ywangan、彬烏倫（Pyin Oo Lwin）一帶是主要產區，因為缺水，傳統以日曬為主，近年才開始有水洗和蜜處理。日曬常見草莓、葡萄、香蕉和酒香，水洗則偏巧克力、麥芽與花香。',
  },
};
