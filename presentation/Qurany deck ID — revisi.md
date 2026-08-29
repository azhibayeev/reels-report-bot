# Qurany — дека на бахасе: разбор и внесённые правки

Файл: Figma `3gVZEBcSmJP2Mefu1Ci2hh`, страница «qurany: final presantation», ряд Bahasa (y=4900).
Эталон смысла — `presentation/Qurany deck EN.pdf`. Текст всех 26 слайдов внесён в Figma; блок «Стало» ниже вычитан обратно из файла.


**Вердикт.** Да, перевод действительно плохой — и не в смысле «суховато», а в трёх независимых плоскостях сразу. Он перевирает хадис ровно на том слайде, где дека хвалится точностью источников. Он вычистил все оговорки, которыми дека отвечала на возражения улама, и оставил голыми утверждения, которые эти оговорки прикрывали. И он занёс английский синтаксис и лексику инвесторской презентации в комнату, где сидят Кеменаг, МУИ и ДМИ.

Корневая причина одна: деку перевели, а не написали заново. Ни один индонезиец не владел этим текстом как документом, предназначенным для этой конкретной комнаты. Переводчик оптимизирует эквивалентность — поэтому вместе со словами выживает и английский порядок слов, и английское представление об аудитории. А оговорки почтения при пословной сверке выглядят как необязательный довесок и выбрасываются первыми, хотя на самом деле именно они несущие.


---

## Что должна решить команда

- **Хадис Sahih Muslim 223 — чинить в обеих деках** (критично) — EN-версия переводит его так же неверно: «Cleanliness is half of faith». Если ходят обе деки, править надо обе, иначе индонезийская сноска обвиняет английскую деку.
- **Источник цифры 53,6%** (критично) — Susenas BPS не измеряет кораническую грамотность, и BPS никогда не публиковал 53,6%. В Индонезии эта цифра ходит со ссылкой на исследование IIQ Jakarta 2018. В переписанном тексте стоит IIQ — но менять источник это не полномочие переводчика. Проверить по первоисточнику и синхронизировать с EN.
- **«ANLDB, Kemenag, 2025»** (критично) — Такой аббревиатуры не существует в обиходе, выглядит искажённой. Назвать перед Кеменагом несуществующее подразделение хуже, чем назвать просто министерство. В тексте оставлено «Kementerian Agama, 2025» — уточнить настоящее имя инструмента.
- **Дословность аята Ali ‘Imran 3:103** (критично) — Подпись «Terjemahan Kementerian Agama RI» обязывает к посимвольному совпадению. Сверить с quran.kemenag.go.id — открывается ли аят с «Dan», «janganlah bercerai berai» или «janganlah kamu bercerai berai». Если сверить не получается, снять подпись, а не отправлять непроверенную атрибуцию.
- **Сканирование лица** (решение) — Биометрия — специальные персональные данные по UU PDP. Фича противоречит слайду 10, где дека осуждает Muslim Pro. В тексте добавлено «только для подбора соперника того же пола, результат сканирования не сохраняется» — но стоит решить, нужна ли фича вообще.
- **Названия Duolingo и PVP** (решение) — Первое — чужой товарный знак в документе для министерства. Второе — геймерский жаргон рядом с Кораном. Предложены Qurany Iqra’ и Qurany Musabaqah; это переименование продукта, а не правка перевода.
- **Обещания на слайде 22** (решение) — «diperbarui secara langsung» и «Audit eksternal setiap tahun» — проверяемые обязательства. Если страница прозрачности ещё не живая, строку надо смягчить или сначала выпустить страницу. Аудитора — назвать или указать год начала.
- **«860 juta» на слайде 24** (решение) — Один из переписывающих дописал «(rata-rata 2025)» — период измерения, которого в EN нет. Это убрано: перевод не должен порождать цифры. Если у команды есть реальное среднее за 2025, добавить в обе деки с источником.
- **Столпы на слайде 2** (решение) — Слайд 2 обещает три столпа — Aplikasi, Gerakan, Pendidikan, — а глава 01 отдаёт четыре ответа, включая медиа. Медиа (слайд 14) — сильнейший аргумент деки, и его нет в открывающем обещании. Это унаследовано из EN, не дефект перевода.

---

## Что намеренно не внесено

- **Слайд 09 — источник цифры 53,6%** — Оставлено как было: «Badan Pusat Statistik, Susenas 2018 — angka yang juga dikutip Kemenag». Смена источника не полномочие переводчика. Сверьте с первоисточником и синхронизируйте с EN-декой, потом поменяем в обеих.
- **Слайд 04 — подпись к аяту** — Поставлено «QS Ali ‘Imran/3: 103» без приписки «Terjemahan Kementerian Agama RI». Вешать атрибуцию можно только после посимвольной сверки с quran.kemenag.go.id — иначе это повтор ошибки слайда 08.
- **Слайд 07 — сноска** — Не стал приписывать 71% и 603 000 к PPATK одной строкой: подтверждено только Rp155 триллионов. Если оба числа тоже из PPATK, скажите — допишу.
- **Подписи-«таблетки» на слайдах 12, 16, 17, 18** — У них фиксированная ширина с фоном и абсолютное позиционирование: удлинение налезает на соседнюю. Оставлены как есть «Tanpa langganan» (просилось «Tanpa fitur berbayar»), «Disusun bersama ulama» (→ «para ulama»), «Bukan ijazah» (→ «Ijazah tetap dari guru»), «Pindai wajah» (→ «Lawan tanding sesama jenis»). Расширьте плашки — и я допишу текст.

### Правки вёрстки

- Слайд 07: «Rp155 triliun» шире, чем блок под этот кегль, и разъезжалось на две строки поверх текста. Единица перенесена в подпись — крупно «Rp155», ниже «triliun berputar di judi online sepanjang 2025.»
- Слайды 09, 18, 20: заголовки перебалансированы по переносу, чтобы остаться в две строки, а не съезжать на три.
- Слайды 14, 16, 22: абзацы подрезаны, чтобы вернуться в свою строку сетки — на 22 текст наезжал на разделительную линейку.
- Слайд 08: сноска опущена с y=750 на 772 — мост «bersuci → kebersihan» важнее 22 пикселей воздуха.
- Слайд 03: сноска опущена с y=794 на 836, потому что врезка стала двухстрочной.
- Слайд 26: атрибуция опущена с y=584 на 656 — индонезийский хадис длиннее английского и занимает три строки.
- Слайд 15: описание третьего пункта заметно длиннее первых двух — работает, но глазу дизайнера стоит на него взглянуть.

---

## Системные проблемы


### 1. Священный текст переведён неверно — на слайде, который ставит на точность источников всю репутацию деки

Это то, чем заканчивается встреча, и чинить надо первым. Слайд 8 цитирует Sahih Muslim 223 — «الطهور شطر الإيمان», где thuhūr значит bersuci, ритуальное очищение, — как «Kebersihan adalah setengah dari iman». Это слово в слово знаменитая индонезийская формулировка слабого хадиса «an-nazhāfatu minal īmān», от которого сноска тремя строками ниже гордо отказывается. Слайд опровергает собственную сноску перед единственной аудиторией, которая это поймает, и ловит она это за три секунды. Мост от тахары к мусору надо строить в тексте под цитатой, а не искажением матна. Та же небрежность во всех остальных священных цитатах: закрывающий хадис на слайде 26 чуть-чуть не тот, который читают с минбара, аят Al-Ma’idah 5:90 пересказан вольно, а формат ссылок везде западный.

- слайд 8: «Kebersihan adalah setengah dari iman.» → “Bersuci itu separuh iman.”
- слайд 8: «NABI MUHAMMAD ﷺ — SAHIH MUSLIM, 223» → Rasulullah ﷺ — HR Muslim, no. 223
- слайд 26: → “Sebaik-baik kalian adalah orang yang mempelajari Al-Qur’an dan mengajarkannya.”
- слайд 7: → “…perbuatan keji dan termasuk perbuatan setan (QS Al-Ma’idah/5: 90)”
- слайд 21: «dijanjikan surga» → dijamin masuk surga (radhiyallahu ‘anhum)

### 2. Выброшена каждая оговорка почтения — и сохранена или дописана каждая переобещающая фраза

Самая разрушительная закономерность в деке, и её не видно, пока не положишь EN и ID рядом. ID — это не столько перевод, сколько неконтролируемая переработка, и перекос у неё всегда в одну сторону: исчезли ровно те предложения, которые предупреждали возражение улама или Кеменага, а утверждения, которые они прикрывали, остались голыми. Слайд 14 потерял «Chosen with the ulama. Short, clear, never a fiqh dispute» — самое важное предложение деки для МУИ и ответ на их первый вопрос. Слайд 17 потерял «An ustaz cannot sit with every student daily», и жест почтения превратился в отговорку, приклеенную к продукту, который явно делает работу устаза. Слайд 15 оставил сканирование лица и выбросил его причину — подбор соперника того же пола — через пять слайдов после того, как дека осудила Muslim Pro за сбор данных. Слайд 22 потерял перечисление, куда идут деньги мухсина (а это и есть питч), и одновременно дописал обещание, которого в EN не было: что и приложение, и движение, и школы, и университет остаются бесплатными на садаку. Слайд 24 потерял слово «казахстанских» в «партнёры министерств» — и в Джакарте это читается как партнёрство с их собственным министерством.

- слайд 14 → Ayat dipilih bersama para ulama: ringkas, jelas, dan tidak menyentuh perkara khilafiyah.
- слайд 17 → Seorang ustaz tidak mungkin mendampingi setiap murid setiap hari.
- слайд 15 → Wajah dipindai hanya untuk memastikan lawan tanding sesama jenis, dan hasil pindaian tidak disimpan.
- слайд 22: удалить «Aplikasi, gerakan, kampus, dan sekolah — semuanya dibiayai dengan satu cara» — обещание бесплатного университета
- слайд 24 → mitra kementerian-kementerian Republik Kazakhstan

### 3. Умма описана словарём рынков, кампаний и завоевания

ID унаследовал инвесторский регистр EN целиком — но читатель ID не инвестор, а алим, чиновник Кеменага или мухсин. Назвать 242 миллиона индонезийцев «Pasar Muslim» — значит вслух сказать ему, что его община это коммерческая возможность, которую вы намерены взять; и это задним числом обнуляет «tanpa model bisnis» на слайде 22. «Siapa yang menang di sini, menang di mana saja» делает умму призом, а казахстанскую компанию — претендентом. «Turun ke jalan» хуже, чем глухота к тону: это значит выйти на демонстрацию, после 2016–2019 слово политически радиоактивно, и стоит оно на слайде 2 так, что «ke masjid» замыкает последовательность — марш, заканчивающийся у мечети. А «kami ajarkan Al-Qur’an kepada mereka» — казахстанская техкомпания заявляет, что учит индонезийских мусульман Корану, — самое прямое присвоение религиозного авторитета в деке.

- слайд 3: «Pasar Muslim» → Negeri dengan umat Islam terbesar sekaligus termuda di dunia
- слайд 3: «Siapa yang menang di sini» → Menguatkan umat di sini berarti menguatkan umat di mana pun.
- слайд 2: «turun ke jalan» → bekerja langsung di sungai, di permukiman, dan di masjid — agar dicontoh
- слайд 13: «kami ajarkan Al-Qur’an kepada mereka» → kami dampingi mereka belajar Al-Qur’an kepada para ustaz
- слайд 20: «Amal yang tercatat» → Amal yang dijalani, bukan yang dihitung — запись деяний принадлежит Ракибу и Атиду, не приложению

### 4. Пословные кальки, которые ломают смысл, а не только стиль

Целый пласт строк перенесён из английского по морфемам и теперь говорит не то, а иногда обратное. «Mengambil waktu» — устойчивая идиома «занимает время, долго», так что слайд 14 сообщает, что телефон «раньше был долгим». «Dengan sendirinya» значит «естественным ходом», так что слайд 12 сообщает, что хатм закрывается сам собой — противоположность утверждению, что работу делает приложение. «Mengirim produk» значит отправлять посылки, так что заголовок слайда о репутации объявляет курьерскую службу. «Tidak butuh mushaf lagi» естественнее всего читается как «мусхаф им больше не нужен» — фразу про мусхаф, которую не хочется объяснять перед ДМИ. А «di mana» в роли относительного местоимения — самый известный маркер переводного текста в индонезийском, его вычёркивают на месте. Каждая из этих правок — три слова, а вместе они и есть почти весь сигнал «это машинный перевод».

- слайд 5: «berdiri antara» → memisahkan umat dari Kitab Sucinya sendiri
- слайд 25: «Kami mengirim produk» → Kami merilis produk
- слайд 12: «dengan sendirinya» → secara otomatis
- слайд 14: «mengambil waktu» → merampas waktu
- слайд 21: «bukan gangguan darinya» → bukan penghalangnya
- слайд 16: «dari titik orang itu benar-benar berada» → Kelas yang berangkat dari kemampuan peserta apa adanya

### 5. Регистр проваливается в разговорный ровно там, где документ должен звучать институционально

Пять кикеров разделов открываются словом «KENAPA» — разговорная форма, — и это задаёт тон всему документу раньше, чем прозвучит первый аргумент. Рядом «tapi», «kalau», «punya», «tahu», «butuh», «ketahuan», «lewat» и торговое «jt». Худшее слово — «fasil», обрезанный студенческий жаргон от fasilitator: половина зала старше сорока его не разберёт, и оно вдобавок неверно по сути — группой тадаруса руководит pengurus или ustaz. В противоположную сторону дека тянется за корпоративными заимствованиями («Proyek», «Solusi», «Kursus», «dasbor», «progres», «PVP») там, где собственный словарь этой аудитории — ikhtiar, jawaban, kelas, kemajuan, musabaqah — ложится куда лучше. В сумме документ звучит одновременно слишком неформально и слишком корпоративно, и ни разу — как серьёзный индонезийский фонд.

- слайды 3, 4, 23, 24, 25: «KENAPA…» → MENGAPA…
- слайд 12: «fasil bisa beristirahat» → pengurusnya tidak lagi sibuk mencatat — ia ikut membaca
- слайд 11: «Solusi Kami» → Jawaban Kami
- слайд 20: «tapi» → tetapi; слайд 12: «kalau sendiri» → bila sendirian
- слайд 6: «punya» → memiliki, и единственное в деке «kita» → kami

### 6. Типографика, числа и юридические ссылки на глаз выглядят иностранными

Ещё до первого прочитанного слова страница объявляет, что её сделали не здесь. Кавычки — «…», русско-французская практика, которой в индонезийской печати нет нигде, и стоят они в том числе на Коране и хадисах. Тысячи на слайде 25 отбиты тонким пробелом («150 000+»), тогда как слайд 7 правильно пишет «603.000» — один документ живёт по двум взаимоисключающим конвенциям. Деньги — «Rp 155 T» в одной строке и «Rp 359 triliun» двумя ниже. «6j 05m» не является сокращением ничего. А единственная ссылка, которая обязана быть точной для читателя из Кеменага — закон о персональных данных, — процитирована задом наперёд и не тем словом: закон называется UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi. На слайде, вся задача которого — юридическая достоверность.

- везде: «…» → “…” (гильеметы стоят на слайдах 4, 8 ×2, 9, 26 — всё это священный текст)
- слайд 25: «150 000+» → 150.000+
- слайд 7: «Rp 155 T» → Rp155 triliun; слайд 6: «6j 05m» → 6 jam 5 menit
- слайд 4: «242 jt» → 242 juta
- слайд 22: → UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP)
- слайд 22: «izin PUB» → izin Pengumpulan Uang atau Barang (PUB) dari Kementerian Sosial

### 7. Самые сильные строки деки потеряли удар — заголовки объявляют тему вместо того, чтобы делать заявление

Английский заголовок слайда 12 — это тезис продукта в четырёх словах: «Istiqamah is easier together». Индонезийский заменил его откашливанием «начнём с самого базового», набранным самым крупным кеглем на первом продуктовом слайде. Трёхтактная дробь слайда 11 — «First the phone. Then the ground. Then the school.» — сплющена в одно вязкое двусоставное предложение на разделителе, у которого только одна работа и есть — ритм; попутно из обоих разделителей (11 и 19) исчез столп движения, хотя слайд 13 целиком о нём, и читателю некуда положить этот слайд. При этом дека уже доказала, что умеет писать на индонезийском в полную силу: «Umat tidak berubah karena diimbau. Umat berubah karena ada yang dicontoh.», «Dikerjakan, bukan dikutip.», «Adab sebelum ilmu» — некоторые из этих строк лучше своих английских оригиналов. Это и есть потолок, до которого надо переписать остальное, и это доказывает, что проблема в процессе, а не в способностях.

- слайд 12 → Istiqamah terasa ringan bila dijalani bersama.
- слайд 11 → Mulai dari aplikasi dan media. Lalu turun ke lapangan. Setelah kepercayaan tumbuh, masuk ke ruang kelas.
- слайд 6 → Enam jam sehari milik mereka, sudah ada yang menguasainya.
- слайд 7: «mengambil uang» → menguras uang mereka
- слайд 22 → Ini bukan model bisnis. Ini model sedekah jariah.

### 8. Названия продуктов, прецеденты и термины выбраны для англоязычного читателя

Три решения по неймингу стоят деке доверия именно в этой комнате, и все три чинятся бесплатно. «Qurany Duolingo» называет продукт коранической грамотности чужим зарегистрированным товарным знаком — в документе, идущем в министерство, — при том что читать Коран в Индонезии учатся по buku Iqro’, а заголовок слайда 9 и есть «Iqra». «Qurany PVP» ставит геймерский жаргон вплотную к Аль-Курану и выдаёт критикам готовую цитату, тогда как у Индонезии уже есть престижная рамка Кеменага для соревновательного чтения — musabaqah / MTQ. А «Preseden: Ant Forest» предлагает геймификацию китайского финтеха Alipay как моральный прецедент для движения уммы — в деке, которая доказывает, что чужие платформы не должны владеть привычками уммы, — когда у Индонезии есть прецеденты, которыми эта аудитория владеет сама: sedekah sampah, керья бакти в мечетях, программы ДМИ.

- слайды 15, 16: «Qurany Duolingo» → Qurany Iqra’
- слайды 15, 18: «Qurany PVP» → Qurany Musabaqah — MTQ dalam genggaman
- слайд 13: «Preseden: Ant Forest» → Contoh nyata: sedekah sampah dan kerja bakti di masjid
- слайд 17: один ярлык вместо двух — mad kurang panjang, gunnah sempurna, makhraj tepat
- слайд 21: «KAMPUS» → UNIVERSITAS — kampus это территория, а не учреждение, выдающее дипломы

---

## Правила регистра

- PRONOUNS AND VOICE. The speaker is always «kami» (Qurany/Galamat), never «kita». Slide 6's «Anak muda kita» is the deck's only «kita» and reads as an accident — a Kazakh company claiming Indonesian youth as "ours". Write «anak muda Indonesia». The reader is «Anda» (slides 10, 15, 17); keep it consistent. The community is «umat» / «umat Islam» / «jemaah» — never «audiens», never «pengguna» when the umat is meant, never «pasar».
- POSTURE. Qurany never teaches, corrects, certifies or records worship. It accompanies, facilitates, brings people to the ustaz, and fills the days in between. Rewrite any sentence where Qurany is the grammatical agent of a religious act: «kami ajarkan Al-Qur'an kepada mereka» → «kami dampingi mereka belajar»; «koreksi tajwid oleh AI» → «masukan tajwid dari AI»; «Amal yang tercatat» → «Amal yang dijalani, bukan yang dihitung».
- GUARDRAIL RULE (binding). Every claim about technology touching religious practice must carry its guardrail clause IN THE SAME ITEM — never as a bare disclaimer. Ayat selection carries «dipilih bersama para ulama, tidak menyentuh perkara khilafiyah»; tajwid feedback carries «ijazah tetap dari guru»; the face scan carries «hanya untuk memastikan lawan tanding sesama jenis, datanya tidak disimpan» or is removed; competition carries «poin bukan pahala, pahalanya ada di sisi Allah». If a guardrail cannot be stated truthfully, delete the feature from the slide.
- NO CLAUSE MAY BE DROPPED IN TRANSLATION. Where the EN anticipates an objection, the ID must too. Restore slide 14 (ulama choose the ayah), slide 17 (an ustaz cannot sit with every student daily), slide 20 (character graded before content; we build the second half back into the curriculum), slide 22 (server, pengembangan, kerja kebersihan — itemise the spend; and «real time» on the dashboard), slide 24 (Kazakh ministries).
- NO CLAUSE MAY BE ADDED THAT COMMITS MONEY. Delete «Aplikasi, gerakan, kampus, dan sekolah — semuanya dibiayai dengan satu cara» (slide 22). The sedekah model covers the app and the programmes; the education plan gets its own stated funding model. A free accredited university promised in a governance section reads to a muhsin as a binding representation.
- FORMALITY. Mengapa (never Kenapa), tetapi/namun (never tapi), bila/jika (never kalau), memiliki (never punya), mengetahui (never tahu), memerlukan (never butuh), melalui (never lewat), tercatat (never ketahuan), di mana pun (never di mana saja), pengurus/fasilitator (never fasil). No clipped forms, no campus slang, no marketplace shorthand anywhere on any slide.
- NO «di mana» AS A RELATIVE PRONOUN. It is the most notorious translationese marker in Indonesian and is struck on sight by any editor at a national foundation. Use «tempat», «yang», or restructure. Slide 3, slide 17.
- NO ORPHAN «-nya». Every «-nya» must have a visible antecedent on the same slide. «kebiasaannya», «Perusahaannya», «Presedennya», «pendidikannya», «jalannya», «milik sendiri» all fail. Use a demonstrative («kebiasaan itu», «perusahaan tersebut») or name the noun.
- PARALLELISM IN LISTS. Every item in a list must be the same part of speech. «Baca, murottal, dan khatam bersama» mixes an imperative, a noun and a verb phrase → «Membaca, menyimak murotal, dan khataman bersama». Same for «materi, ruhani, dan fisik» (noun + two adjectives) → «harta, rohani, dan jasmani». Same for the paired aphorisms: «Membaca itu awal. Mengamalkan itu tujuannya.» — both halves take the same shape.
- HEADLINES MUST ASSERT, NOT ANNOUNCE. A headline that reads as a table-of-contents entry has failed. «Mulai dari yang paling dasar: istiqamah» → «Istiqamah terasa ringan bila bersama.» Chapter dividers keep the three-beat rhythm and keep all three pillars: aplikasi dan media → lapangan → ruang kelas. Slides 11 and 19 currently drop the movement from both dividers even though slide 13 is entirely about it.
- NO SENTENCE-INITIAL «Dan». The cover line «Aplikasi Al-Qur'an gratis untuk Indonesia. Dan sebuah gerakan untuk umat.» becomes «Aplikasi Al-Qur'an gratis untuk Indonesia — sekaligus gerakan untuk umat.»
- DROP «sebuah» AND «seorang» BEFORE ABSTRACT AND GENERIC NOUNS. «sebuah gerakan», «sebuah negeri», «seorang ulama» import the English indefinite article. Write «gerakan», «satu negeri», «ulama mana pun».
- QUOTATION MARKS. Straight Indonesian double quotes "…" throughout. Guillemets «…» are Russian/French and appear nowhere in Indonesian publishing — and in this deck they currently enclose the Qur'an and two hadith (slides 4, 8, 9, 26).
- EM DASHES. Maximum one per sentence and one per slide element; PUEBI sets tanda pisah unspaced. Convert the rest to commas, colons or full stops. The current one-to-three-per-slide density is English rhythm and is a large part of why the deck reads as translated. Avoid semicolons in body copy (slides 8, 14); Indonesian formal prose rarely uses them.
- NUMBERS. Period as thousands separator, comma as decimal: 150.000+, 1.000.000+, 603.000, 53,6%, 30,7. Never thin spaces. Magnitudes spelled out: 242 juta, 860 juta, Rp155 triliun, Rp5 juta — «Rp» closed up to the numeral, no space, no period. Time as «6 jam 5 menit». Clock and score colons closed up: 0:14, Ronde 3/5.
- TITLE CASE. Prepositions, conjunctions and particles stay lowercase unless they open the title: «Rencana ke Depan», not «Rencana Ke Depan». Kicker system must be consistent — one pattern (KICKER · NAMA) applied across slides 15–18, 20–21 and 24–25, which currently run three incompatible schemes.
- SACRED TEXT IS QUOTED, NEVER RE-TRANSLATED. Use the received Indonesian wording every reader already carries: the Kemenag terjemahan for any ayat (verbatim, and name it), and the standard Indonesian rendering for any hadith. Citations: «QS Ali 'Imran/3: 103», «HR Muslim, no. 223», «HR Bukhari, no. 5027». Attribute hadith to «Rasulullah ﷺ», never to «NABI MUHAMMAD» in all caps. Any Arabic transliteration is italicised and fully marked.
- ARABIC LOANWORDS: ONE POLICY, DECLARED AND APPLIED. Follow KBBI/Kemenag adapted spellings across the whole deck — murotal, daif, mad, rohani, jemaah. If «istiqamah» is retained (defensible: MUI's own documents use it), retain it everywhere and fix the other four, so the reader sees one editor with one style sheet.
- EVERY NUMBER CARRIES A NOUN AND A SOURCE THAT SURVIVES A GOOGLE SEARCH. Slide 9's «65%» has no noun attached to it in either language — 65% of what? — and sits unreconciled beside 53,6%. Spell out ANLDB on first use or replace it with a verifiable Kemenag instrument. Re-check the BPS/Susenas attribution for 53,6% and the 603.000 PPATK figure before the deck goes out. Slide 16's «Separuh negeri ini belum bisa membaca Al-Qur'an» contradicts slide 9's own sourced figure (53,6% of adult Muslims) — write «Separuh umat Islam dewasa di negeri ini». Slide 6's «waktu layar» widens data.ai's mobile-only figure to all screens; write «di ponsel setiap hari».
- «negara» FOR THE INSTITUTION, «negeri» FOR THE LAND. Slide 19 means the state that grants permits and recognition — Kemenag, the regulator whose permission the school and university plan requires. «kepercayaan negeri ini» is vague where the EN is precise, and the precision is what flatters the officials in the room.
- LONG-HORIZON PLANS ARE MARKED AS SUCH. The university slide must locate itself in time and inside the permitting process («dalam jangka panjang, melalui jalur perizinan resmi»). An unqualified «kami akan mengajarkan… di kampus», presented to the ministries that issue izin pendirian, reads as either naivety or a promise the team cannot keep — and it is the last substantive claim before the credibility chapter.

---

## Глоссарий

| Писать | Не писать | Почему |
|---|---|---|
| Mengapa | Kenapa | Formal written register. Applies to all five section kickers (slides 3, 4, 23, 24, 25). Non-negotiable for a document addressed to MUI and Kemenag. |
| umat Islam / umat / penduduk muslim | Pasar Muslim | Never describe Indonesian Muslims as a market anywhere in the ID deck. Slide 3. This single word invalidates slide 22's "tanpa model bisnis" retroactively. |
| turun ke lapangan / bergerak langsung di lapangan | turun ke jalan | "Turun ke jalan" means staging a street demonstration and is politically radioactive after 2016–2019. Slide 2. |
| kegiatan | aksi | "Aksi" carries the demonstration sense (aksi 411/212), especially two slides after turun ke jalan. Slide 13. |
| ikhtiar | Proyek | "Proyek" is donor-agency and construction vocabulary; ikhtiar carries the humility this audience expects. Slide 2. |
| Jawaban Kami (or Ikhtiar Kami) | Solusi Kami | "Solusi" is consultancy register and sits oddly in a deck reaching for religious-institutional voice. Slide 11. |
| kelas / program belajar | Kursus | "Kursus" is course-vendor vocabulary; Kemenag would say kelas. Slide 16. |
| kepercayaan tumbuh / terbangun | kepercayaan terkumpul | Trust is not collected like donations; "terkumpul" makes it transactional in exactly the register this audience is most alert to. Slides 11 and 19. |
| merilis / membangun dan merilis | mengirim produk | "Mengirim produk" means physically dispatching goods. Slide 25 headline. |
| secara otomatis | dengan sendirinya | "Dengan sendirinya" means "as a natural consequence", not "automatically". Slide 12. |
| menuntaskan khatam / merapikan laporan khataman | menutup khatam | Not an Indonesian collocation, and it hands a devotional act to software. Slide 12. |
| merampas / menyita waktu | mengambil waktu | "Mengambil waktu" is the standard idiom for "is time-consuming" — a genuine meaning collision. Slide 14. |
| menguras uang | mengambil uang | Menguras is the standard, far stronger verb for being drained by gambling. Slide 7 headline about Rp155 triliun. |
| menguasai | memiliki (of the six hours / of data) | Memiliki is neutral legal possession; the argument is about seizure and control. Slides 6 and 10. |
| menghimpun (audiens/perhatian) · mengabdikan | mengumpulkan · mengarahkan | Mengumpulkan makes the audience sound like inventory; "kami arahkan" describes aiming a targeting apparatus at the umat. Slide 24. |
| diturunkan menjadi (satu amalan) | diterjemahkan menjadi | Diterjemahkan collides with tarjamah Al-Qur'an and suggests you are translating the Qur'an into an amal. Slide 14. |
| mengamalkan / amal | praktik | The audience's own vocabulary, warmer and stronger, and keeps verb-verb parallelism. Slides 14, 20. |
| pengurus grup / fasilitator / ustaz | fasil | Campus-organisation slang; the person who runs an Indonesian tadarus group is the pengurus, never a "fasil". Slide 12. |
| jemaah | jamaah | KBBI headword and Kemenag's own spelling (jemaah haji). Slide 13, twice. |
| murotal | murottal | KBBI. The deck follows KBBI scrupulously elsewhere (salat, akhlak, maisir, khamar, tajwid, jariah, ustaz), so this is an internal inconsistency. Slide 2. |
| riwayat daif | bentuk dhaif / riwayat dhaif | One classifies a riwayat, not a "bentuk"; KBBI adapts to daif. Slide 8 footnote, which is the deck's explicit bid for scholarly credibility. |
| mad (mad thabi'i, mad kurang panjang) | madd | Indonesian tajwid literature and KBBI write mad. Use one label per fault across slides 15, 17, 18 — never "madd kurang panjang" in the caption and "Madd pendek" in the chip. |
| gunnah sempurna · makhraj tepat | ghunnah bersih · makhraj bersih | "Bersih" is a calque of English "clean"; the tajwid classroom says sempurna, tepat, jelas, samar. Slide 17. |
| hukum bacaan | hukum | Bare "hukum" reads as a fiqh ruling (halal/haram/wajib). Slide 18 quiz question. |
| istikamah — OR keep istiqamah as declared policy | mixing both | Pick one and declare it. Recommended: keep "istiqamah" (the form MUI's own documents use) but then fix murottal→murotal, dhaif→daif, madd→mad so one style sheet is visible. |
| Bersuci / Kesucian itu separuh iman | Kebersihan adalah setengah dari iman | Sahih Muslim 223 is at-thuhūru shatrul īmān. The current wording IS the daif narration the footnote disowns. Highest-severity item in the deck. Slide 8. |
| separuh | setengah | Applies to the hadith register and to statistics; the deck already writes "Separuh negeri ini" on slide 16 but "Setengah negeri" on slide 4. |
| HR Muslim, no. 223 · HR Bukhari, no. 5027 | SAHIH MUSLIM, 223 · SAHIH AL-BUKHARI, 5027 | Indonesian religious publishing uses Hadis Riwayat. Slides 8, 22, 26. |
| Rasulullah ﷺ | NABI MUHAMMAD ﷺ (all caps) | Indonesian dakwah attributes to Rasulullah, not to a name-label, and setting the Prophet's name in all caps reads as irreverent. Slide 8. Slide 26 currently has no attribution to the Prophet at all — add "Rasulullah ﷺ bersabda:". |
| QS Ali 'Imran/3: 103 · QS Al-Ma'idah/5: 90 | ALI 'IMRAN 3:103 · (Al-Ma'idah 5:90) | Bare Book Chapter:Verse is a Western/Bible citation habit and marks the document as foreign at a glance. Slides 4 and 7 currently use two different foreign formats. |
| sepuluh sahabat yang dijamin masuk surga | sepuluh sahabat yang dijanjikan surga | Fixed Indonesian term for al-'asyarah al-mubasysyarun bil jannah. Add radhiyallahu 'anhum. Slide 21. |
| pahalanya ada di sisi Allah | ganjaran hanya ada pada Allah | Fixed Indonesian religious formula. "Pada Allah" is a preposition slip. Slide 18. |
| rohani dan jasmani (harta, rohani, jasmani) | materi, ruhani, dan fisik | KBBI spells rohani, and Indonesian pairs it idiomatically with jasmani; the current triplet is also not grammatically parallel. Slide 21. |
| bukan penghalangnya | bukan gangguan darinya | "Gangguan darinya" would mean interference coming FROM it. Closing line of the deck's boldest claim. Slide 21. |
| universitas / perguruan tinggi | kampus | Kampus is the physical grounds, not the degree-granting institution; before Kemenag/Dikti it sounds legally vague. Slide 21 heading, headline and render caption. |
| Qurany Iqra' | Qurany Duolingo | Another company's trademark used as a product name in a document going to a ministry; Iqra' names it in the audience's own memory and echoes the deck's own slide 9. Slides 15, 16. |
| Qurany Musabaqah | Qurany PVP | MTQ is run by Kemenag and revered; musabaqah turns the deck's most objectionable feature into its most familiar one. Slides 15, 18. |
| Contoh nyata | Preseden (for positive examples) | Preseden carries a legal and usually negative charge (preseden buruk) — the deck itself uses it correctly and negatively on slide 10, so it cannot also introduce inspiring examples on slides 13 and 22. |
| broker data / perantara data | pialang data | Pialang is a stockbroker; Indonesian tech and privacy reporting says broker data. Slide 10, the deck's data-sovereignty argument. |
| tercatat / terdeteksi | ketahuan | "Ketahuan" is the word for a child caught misbehaving; a PPATK finding presented to officials takes tercatat. Slide 7. |
| memerlukan / membutuhkan | butuh | Spoken form, and it appears twice in one sentence on slide 16. |
| melalui | lewat | Spoken form; should not sit in a chapter opener. Slide 11. |
| mengetahui | tahu | Slide 10. |
| memiliki | punya | Slide 6. |
| tetapi / namun | tapi | Slide 20 — one of the best lines in the deck, needing only its register lifted. |
| bila / jika | kalau | Slide 12. |
| di mana pun | di mana saja | The pun particle is what makes an Indonesian rhetorical absolute sound finished. Slide 3. |
| dan | & | PUEBI; the ampersand belongs in a logo. Slide 22 heading. |
| 242 juta · 36 juta · 860 juta · Rp155 triliun | 242 jt · 36 jt+ · 860 jt · Rp 155 T | "jt" and "T" are marketplace and trading-floor shorthand. The deck already writes "500 juta" and "Rp 359 triliun" correctly, so it currently contradicts itself. |
| 6 jam 5 menit | 6j 05m | Not an Indonesian abbreviation of anything; it sits in the deck's largest type. Slide 6. |
| kementerian-kementerian Republik Kazakhstan | kementerian | Unqualified, an Indonesian official reads this as partnership with his own ministry — a misrepresentation of institutional standing. Slide 24. |
| UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP) | UU PDP No. 27/2022 | Indonesian legal citation is number-first with Tahun spelled out; the official title uses Pelindungan, not Perlindungan. Slide 22. |
| izin Pengumpulan Uang atau Barang (PUB) dari Kementerian Sosial sebelum penggalangan dana publik | izin PUB sebelum penggalangan | Penggalangan is incomplete without dana; expanding PUB and naming Kemensos is what proves you have read the regulation. Slide 22. |
| Berbadan hukum yayasan Indonesia | Yayasan Indonesia | As written it reads as the proper name of an organisation rather than a legal status. Slide 22. |

---

## Слайд за слайдом


### Слайд 1

**Что было не так:**

- `Aplikasi Al-Qur’an gratis untuk Indonesia. Dan
sebuah gerakan untuk umat.` — The English em-dash apposition was broken into a full stop plus "Dan", which in Indonesian reads as an afterthought rather than a build. "Sebuah gerakan" imports the English indefinite article — Indonesian drops it, and "sebuah" for an abstract noun like gerakan sounds distinctly translated. This is the first line of the deck.

**Было:**

```
UMAT YANG MEMBACA
Qurany
Aplikasi Al-Qur’an gratis untuk Indonesia. Dan
sebuah gerakan untuk umat.
GALAMAT TECH · 2026
```

**Стало (в Figma):**

```
UMAT YANG MEMBACA
Qurany
Aplikasi Al-Qur’an gratis untuk Indonesia — sekaligus gerakan untuk umat.
GALAMAT TECH · 2026
```


### Слайд 2

**Что было не так:**

- `Bukan sekadar aplikasi.
Sebuah gerakan untuk umat.` — "Sebuah gerakan untuk umat" as a standalone sentence is an English nominal fragment. Indonesian needs a demonstrative or copula to make the second half land as a declaration: "Ini gerakan umat." As written it hangs.
- `Baca, murottal, dan khatam bersama — di
dalam grup, bukan sendirian.` — Broken parallelism: "Baca" is a bare verb, "murottal" is a noun, "khatam bersama" is a verb phrase — the list does not scan in Indonesian. And "di dalam grup" is a literal "in a group"; di dalam is spatial (inside a container), so it reads oddly physical. Indonesian says "dalam grup" or, better for this audience, "bersama jamaah".
- `Kreator dan komunitas turun ke jalan, ke
sungai, dan ke masjid.` — "Turun ke jalan" in Indonesian overwhelmingly means to demonstrate / stage a street protest. Placed first in the list, in a deck for MUI and Kemenag, it reads as political mobilisation rather than community service. The idiom you want is "turun ke lapangan".
- `turun ke jalan, ke sungai, dan ke masjid` — 'Turun ke jalan' in Indonesian means one thing first: taking to the streets to demonstrate. In a deck being read by Kemenag officials and MUI, a slide announcing that creators and communities will 'turun ke jalan' reads as mobilising street action — and putting 'ke masjid' at the end of that sequence makes it read like a march that ends at the mosque. It is also politically radioactive after 2016–2019. The English meant nothing of the sort ('acting in public'). This single phrase can end a meeting.
- `01 Aplikasi Baca, murottal, dan khatam bersama — di
dalam grup, bukan sendirian.` — Broken parallelism: «Baca» is an imperative verb, «murottal» and «khatam» are nouns, so the list reads as three unrelated parts of speech strung together. In a three-item list on the deck's second slide this is the most conspicuous grammar error in the document. (Note also that the standard Indonesian spelling is «murotal»/«murattal»; «murottal» is the informal media spelling.)
- `02 Gerakan Kreator dan komunitas turun ke jalan, ke
sungai, dan ke masjid.` — «turun ke jalan» is a fixed Indonesian collocation meaning to stage a street demonstration — it carries an unmistakable protest/unrest connotation. Presented to MUI, Kemenag and DMI on slide 2, it frames the movement as agitation rather than service. «turun ke sungai» is also literal-sounding and slightly comic. The EN («acting in public — so others follow») has none of this.

**Было:**

```
TENTANG QURANY
Bukan sekadar aplikasi.
Sebuah gerakan untuk umat.
Proyek untuk menguatkan umat Indonesia. Dibangun untuk Indonesia, di bawah
bimbingan ulama Indonesia.
01 Aplikasi Baca, murottal, dan khatam bersama — di
dalam grup, bukan sendirian.
02 Gerakan Kreator dan komunitas turun ke jalan, ke
sungai, dan ke masjid.
03 Pendidikan Kampus dan sekolah yang mengajarkan
Islam lewat praktik, bukan hafalan semata.
QURANY · UMAT YANG MEMBACA 02 / 26
```

**Стало (в Figma):**

```
TENTANG QURANY
Bukan sekadar aplikasi.
Ini gerakan untuk umat.
Ikhtiar untuk menguatkan umat Indonesia. Dibangun untuk negeri ini, di bawah bimbingan para ulama Indonesia.
Aplikasi
Membaca, menyimak murotal, dan khataman bersama dalam satu grup, bukan sendirian.
01
Gerakan
Kreator dan komunitas bekerja langsung di sungai, di permukiman, dan di masjid — agar dicontoh.
02
Pendidikan
Sekolah dan perguruan tinggi yang mengajarkan Al-Qur’an sebagai amal, bukan hafalan semata.
03
QURANY · UMAT YANG MEMBACA
02 / 26
```


### Слайд 3

**Что было не так:**

- `satu-satunya
tempat di mana hijrah di kalangan anak muda menjadi budaya arus
utama` — "Tempat di mana" is the single most notorious translationese marker in Indonesian — "di mana" as a relative pronoun is imported from English "where" and is condemned by every Indonesian style guide and by Badan Bahasa. Any editor at a national foundation strikes it on sight. "Budaya arus utama" is also a stacked calque of "mainstream culture"; Indonesian just says "arus utama".
- `KENAPA KAMI MULAI DI SINI` — "Kenapa" is spoken register. In a deck addressed to MUI, Kemenag and DMI, section titles use "Mengapa". This recurs on slides 4 (KENAPA INDONESIA), 23 (Kenapa Kami) and 24 (KENAPA KAMI 01) — four section headers in the informal register, which sets the tone for the whole document. Separately, "mulai di sini" is a calque of "start here"; Indonesian says "mulai dari sini".
- `Pasar Muslim terbesar sekaligus termuda di dunia` — Calling Indonesia the largest and youngest 'Pasar Muslim' tells the reader the umat is a market. In English, to an investor, this is normal. In Bahasa, to ulama and to Kemenag, it says out loud that 87% of this country is a commercial opportunity you intend to capture — and it undercuts the entire slide 22 claim of 'tanpa model bisnis'. Every subsequent humility line is read through this word.
- `Siapa yang menang di sini, menang di mana saja.` — Straight conquest framing — 'whoever wins here wins everywhere'. Paired with 'Pasar Muslim' in the line above, it makes the umat the prize in someone else's competition, and it makes the presenter the competitor. Indonesians reading a dakwah deck expect the direction of service, not the direction of conquest.
- `KENAPA KAMI MULAI DI SINI` — «Kenapa» is the colloquial/spoken form; the formal written form is «mengapa». In a document for ulama, Kemenag and DMI, «kenapa» in a section kicker sounds like a blog headline. The error is systemic: it also heads slides 4 («KENAPA INDONESIA · ANGKA»), 23 («Kenapa Kami»), 24 and 25 («KENAPA KAMI 01 / 02»). Fix all five together.
- `Pasar Muslim terbesar sekaligus termuda di dunia` — «Pasar Muslim» — market — is investor-deck vocabulary. Said to ulama, Kemenag and DMI it turns the ummah into a commercial opportunity, which is the precise suspicion this deck must not raise; slide 22 then insists there is «tanpa model bisnis». The ID deck is not obliged to follow the EN's «market» here.

**Было:**

```
KENAPA KAMI MULAI DI SINI
Indonesia
Pasar Muslim terbesar sekaligus termuda di dunia — satu-satunya
tempat di mana hijrah di kalangan anak muda menjadi budaya arus
utama, dan dari sinilah tren menyebar ke seluruh umat.
Siapa yang menang di sini, menang di mana saja.
Majelis taklim dan grup tadarus sudah berjalan setiap hari — kebiasaannya tidak perlu
diciptakan, cukup diberi alat.
QURANY · UMAT YANG MEMBACA 03 / 26
```

**Стало (в Figma):**

```
MENGAPA MULAI DARI SINI
Indonesia
Negeri dengan umat Islam terbesar sekaligus termuda di dunia. Hanya di sini hijrah di kalangan anak muda tumbuh menjadi arus utama, dan dari sinilah tren menyebar ke seluruh umat.
Menguatkan umat di sini berarti menguatkan umat di mana pun.
Majelis taklim dan grup tadarus sudah berjalan setiap hari — kebiasaan itu tidak perlu diciptakan. Yang belum ada hanyalah sarananya.
QURANY · UMAT YANG MEMBACA
03 / 26
```


### Слайд 4

**Что было не так:**

- `«Dan berpegangteguhlah kamu semuanya pada tali (agama) Allah, dan janganlah bercerai-berai.»` — Two problems. (1) The guillemets «» are Russian/French typography and are used nowhere in Indonesian publishing — the Indonesian convention is the double quotation mark "…". This is the single most visible foreign fingerprint in the deck; it recurs on slides 8 (twice), 9, and 26. (2) The wording is the Kemenag translation but altered: Kemenag reads «…dan janganlah kamu bercerai berai». Quoting the official terjemahan with a word dropped, and without naming it, is exactly the sloppiness slide 8 promises to avoid. Also, «berpegangteguhlah» written solid is correct only because it is a verbatim Kemenag quotation — it should therefore be verbatim.
- `242 jt` — «jt» is marketplace/price-tag shorthand and has no place in a formal deck; the same abuse appears on slide 24 as «36 jt+» and «860 jt», while slide 13 correctly writes «500 juta». So the deck is internally inconsistent about its single most-repeated unit. Write the word out.
- `ALI ‘IMRAN 3:103` — Chapter-and-verse set as «3:103» is the English/Western convention. Indonesian religious publishing uses «QS Ali 'Imran [3]: 103» (or at minimum «QS Ali 'Imran: 103»). The deck is also internally inconsistent: slide 7 writes it a third way, «(Al-Ma'idah 5:90)». Standardize both.

**Было:**

```
KENAPA INDONESIA · ANGKA
Di sinilah umat itu berada.
242 jt 87% 53% 30,7
Muslim di Indonesia — populasi Muslim dari seluruh penduduk negeri ini. penduduk adalah Gen Z dan Milenial. usia median. Setengah negeri lebih muda.
terbesar di dunia.
«Dan berpegangteguhlah kamu semuanya pada tali (agama) Allah, dan janganlah bercerai-berai.»
ALI ‘IMRAN 3:103
Sumber: World Population Review 2024 · Sensus Penduduk 2020, BPS · UN World Population Prospects 2024
QURANY · UMAT YANG MEMBACA 04 / 26
```

**Стало (в Figma):**

```
MENGAPA INDONESIA · DALAM ANGKA
Di sinilah umat itu hidup.
242 juta
87%
53%
30,7
umat Islam di Indonesia, populasi Muslim terbesar di dunia.
dari seluruh penduduk negeri ini.
penduduk adalah Gen Z dan milenial.
usia median. Separuh negeri ini lebih muda dari itu.
“Berpegangteguhlah kamu semuanya pada tali (agama) Allah dan janganlah bercerai berai.”
QS Ali ‘Imran/3: 103
Sumber: World Population Review 2024 · Sensus Penduduk 2020, BPS · UN World Population Prospects 2024
QURANY · UMAT YANG MEMBACA
04 / 26
```


### Слайд 5

**Что было не так:**

- `Lima masalah berdiri antara umat dan kitabnya sendiri.` — Word-for-word calque of "stand between". In Indonesian, masalah do not "berdiri" — berdiri is used for people, buildings, and institutions. The line reads like a machine rendering and, worse, it is the single sentence that sets up five slides. An Indonesian reads it and hears the English underneath.
- `Lima masalah berdiri antara umat dan kitabnya sendiri.` — Word-for-word rendering of «stand between». Indonesian does not use «berdiri antara» metaphorically; the natural verbs are «menghalangi … dari» or «membentang antara». As written it sounds like five people physically standing somewhere.

**Было:**

```
LIMA MASALAH
Umat terbesar di dunia
belum menjadi umat terkuat.
Lima masalah berdiri antara umat dan kitabnya sendiri.
QURANY · UMAT YANG MEMBACA 05 / 26
```

**Стало (в Figma):**

```
LIMA MASALAH
Umat terbesar di dunia
belum menjadi umat terkuat.
Lima masalah memisahkan umat dari Kitab Sucinya sendiri.
QURANY · UMAT YANG MEMBACA
05 / 26
```


### Слайд 6

**Что было не так:**

- `Enam jam sehari
sudah ada yang memiliki.` — The fronted object is a legitimate Indonesian device, but "sudah ada yang memiliki" is limp — memiliki is a neutral legal/possessive verb, and the English "owns" here means seizes and controls. As a headline it has no force at all; it sounds like someone already bought the six hours.
- `6j 05m` — «6j 05m» is not an Indonesian abbreviation of any kind — Indonesian has no convention of «j» for jam and «m» for menit, and the padded «05» is a digital-clock artifact. It reads as untranslated foreign notation sitting in the deck's largest type.
- `Anak muda kita punya pembimbing enam jam sehari` — Two issues. (1) «punya» is spoken; formal written Indonesian takes «memiliki». (2) This is the deck's only «kita» — every other first-person reference is «kami» (kami mulai, Solusi Kami, kami terima, keahlian kami, kami kerjakan). A lone inclusive «kita» from a Kazakh company claiming Indonesian youth as «ours» is either a deliberate ummah-solidarity move or an accident; as it stands it reads as an accident, because nothing else in the deck supports it. Decide: either commit to «kita» as ummah in several places, or write «anak muda Indonesia» here.

**Было:**

```
MASALAH 01
Enam jam sehari
sudah ada yang memiliki.
6j 05m
waktu layar per hari — tertinggi di dunia.
data.ai, State of Mobile 2024
Anak muda kita punya pembimbing enam jam sehari: algoritma yang
dioptimalkan untuk menjual iklan — bukan untuk membentuk akhlak.
QURANY · UMAT YANG MEMBACA 06 / 26
```

**Стало (в Figma):**

```
MASALAH 01
Enam jam sehari milik mereka,
sudah ada yang menguasainya.
6 jam 5 menit
di ponsel setiap hari — tertinggi di dunia.
data.ai, State of Mobile 2024
Anak muda Indonesia memiliki pembimbing yang berbicara kepada mereka enam jam sehari: algoritma yang dirancang untuk menjual iklan, bukan untuk membentuk akhlak.
QURANY · UMAT YANG MEMBACA
06 / 26
```


### Слайд 7

**Что было не так:**

- `Enam jam yang sama
juga mengambil uang mereka.` — "Mengambil uang" is flat and literal for "take their money" — it describes picking up cash, not being drained by gambling. Indonesian has a much stronger, entirely standard verb for exactly this: menguras. As a headline about Rp 155 trillion, the current line under-delivers badly.
- `Al-Qur'an menyebut maisir bersama khamar sebagai perbuatan setan (Al-Ma'idah 5:90).` — Al-Ma'idah 5:90 says these are 'rijsun min 'amali asy-syaithan' — Kemenag: 'perbuatan keji dan termasuk perbuatan setan'. Compressing that to 'perbuatan setan' drops both 'keji' and the crucial 'termasuk', and in front of ulama a loosely paraphrased ayat is worse than no ayat: precision in quoting the Qur'an is the thing they audit first. Citation format is also foreign — Indonesians expect 'QS Al-Ma'idah/5: 90'. The terms 'maisir' and 'khamar' themselves are spelled correctly per KBBI.
- `Rp 155 T` — Three violations in five characters. (1) PUEBI sets «Rp» closed up to the numeral with no space and no period: Rp155. (2) «T» for triliun is trading-floor shorthand, not written Indonesian. (3) It contradicts the very next line of the same slide, which correctly writes «Rp 359 triliun» — so the deck uses two different conventions for the same unit two lines apart. The footnote and body («Rp 5 juta») carry the same spacing error.

**Было:**

```
MASALAH 02
Enam jam yang sama
juga mengambil uang mereka.
Rp 155 T
berputar di judi online sepanjang 2025 — setelah penindakan nasional.
PPATK, 2025 — turun dari Rp 359 triliun pada 2024
Al-Qur’an menyebut maisir bersama khamar sebagai perbuatan setan (Al-Ma’idah
5:90). Hari ini ia datang lewat notifikasi: 71% pemainnya berpenghasilan di bawah Rp
5 juta sebulan, dan 603.000 penerima bantuan sosial ketahuan berjudi.
QURANY · UMAT YANG MEMBACA 07 / 26
```

**Стало (в Figma):**

```
MASALAH 02
Enam jam yang sama
juga menguras uang mereka.
Rp155
triliun berputar di judi online sepanjang 2025.
PPATK, 2025. Setelah penindakan nasional, turun dari Rp359 triliun pada 2024.
Al-Qur’an menyebut maisir bersama khamar sebagai perbuatan keji dan termasuk perbuatan setan (QS Al-Ma’idah/5: 90). Kini ia datang melalui notifikasi: 71% pemainnya berpenghasilan di bawah Rp5 juta sebulan, dan 603.000 penerima bantuan sosial tercatat menghabiskan bantuannya untuk berjudi.
QURANY · UMAT YANG MEMBACA
07 / 26
```


### Слайд 8

**Что было не так:**

- `«Kebersihan adalah
setengah dari iman.»` — Two problems in one line. Stylistically, "setengah dari iman" is a literal "half of faith"; Indonesian says "separuh iman". Substantively, the footnote below proudly says the deck cites the sahih narration and not the weak «an-nazhafatu minal iman» — but "Kebersihan" is exactly the wording of that weak hadith. The sahih narration (ath-thuhuru shatrul iman) is rendered in Indonesian as "Kesucian" / "Bersuci". As it stands, the slide contradicts its own footnote in front of the one audience that will notice instantly.
- `Dan setengah iman itu masih menunggu.` — "Masih menunggu" is a literal "is still waiting" and in Indonesian leaves the reader hanging — waiting for what, from whom? English tolerates this abstraction; Indonesian wants a concrete verb with an agent. Also "setengah iman" should be "separuh iman" to match the hadith register.
- `«Kebersihan adalah setengah dari iman.»` — This is the fatal one. Sahih Muslim 223 is «الطهور شطر الإيمان» — thuhur means bersuci / kesucian (ritual purification), not kebersihan (hygiene). 'Kebersihan sebagian dari iman' is precisely the wording of the daif/unattributed hadith «an-nazhafatu minal iman» — the very hadith the footnote on this same slide proudly says the deck refuses to cite. So the slide announces 'ketepatan sumber adalah prinsip kami' and then, one line above, quotes the sahih narration using the daif narration's words. Any ustaz, and certainly anyone at MUI, spots this instantly, and the credibility built by the footnote inverts into embarrassment. The bridge from thaharah to sampah/kebersihan must be made in the body text, not by mistranslating the matan.
- `NABI MUHAMMAD ‫ — ﷺ‬SAHIH MUSLIM, 223` — Three problems in one line. (a) 'SAHIH MUSLIM, 223' is a Western citation format; Indonesian religious publishing writes 'HR Muslim, no. 223' (Hadis Riwayat) — the same applies to 'SAHIH MUSLIM, 1631' on slide 22 and 'SAHIH AL-BUKHARI, 5027' on slide 26. (b) Indonesian dakwah attributes a hadith to 'Rasulullah ﷺ', not to 'Nabi Muhammad' as a name-label. (c) Setting the Prophet's name in all caps as a typographic label reads as irreverent to Indonesian religious editors; the honorific glyph does not rescue it.
- `«Kebersihan adalah
setengah dari iman.»
NABI MUHAMMAD ﷺ — SAHIH MUSLIM, 223` — Self-contradiction that this exact audience will catch instantly. The footnote on the same slide boasts that the deck cites the sahih narration and not the weak «an-nazhafatu minal iman» — but «Kebersihan … setengah dari iman» IS the famous Indonesian wording of that weak narration. Sahih Muslim 223 is «الطُّهُورُ شَطْرُ الإِيمَانِ», which in Indonesian is rendered «Bersuci itu separuh iman» — thaharah/bersuci, not kebersihan. Separately, «setengah dari iman» is a calque; Indonesian says «separuh iman». And hadith attribution in Indonesian publishing is «HR Muslim, no. 223», never «SAHIH MUSLIM, 223». An ustaz reading this slide concludes the deck does not know the difference it is claiming to know.
- `«Kebersihan adalah setengah dari iman.»
NABI MUHAMMAD ﷺ — SAHIH MUSLIM, 223` — Sahih Muslim 223 is «الطُّهُورُ شَطْرُ الإِيمَانِ» — at-tuhūru shatrul īmān — which means *bersuci* (ritual purification: wudhu, ghusl, thaharah), not *kebersihan* (hygiene/cleanliness of the environment). The deck renders it as «Kebersihan adalah setengah dari iman», which is precisely the meaning of the weak «an-nazhafatu minal iman» that the footnote on this same slide loudly claims to have avoided. Any ustaz in the room catches this immediately: the slide cites the sahih chain but delivers the dhaif meaning, and then builds a garbage/river argument on a hadith about ablution. This is the most damaging single line in the ID deck — it destroys the credibility the footnote was written to buy, on the one slide that stakes a claim to sourcing rigour.

**Было:**

```
MASALAH 03
«Kebersihan adalah
setengah dari iman.»
NABI MUHAMMAD ‫ — ﷺ‬SAHIH MUSLIM, 223
Dan setengah iman itu masih menunggu.
Kebersihan sudah menjadi agenda nasional — Gerakan Indonesia Bersih, Citarum
Harum, dan agenda Dewan Masjid Indonesia. Sampah bukan sekadar urusan
kota; ia medan iman.
Kami sengaja mengutip riwayat sahih, bukan bentuk dhaif «an-nazhafatu minal iman» — ketepatan sumber adalah
prinsip kami.
QURANY · UMAT YANG MEMBACA 08 / 26
```

**Стало (в Figma):**

```
MASALAH 03
“Bersuci itu
separuh iman.”
Rasulullah ﷺ — HR Muslim, no. 223
Separuh iman itu belum selesai dikerjakan.
Bersuci adalah pangkal iman, kebersihan lingkungan wujud lahiriahnya. Kini ia menjadi agenda nasional: Gerakan Indonesia Bersih, Citarum Harum, dan program Dewan Masjid Indonesia. Sampah bukan sekadar urusan kota, melainkan ladang amal.
Kami sengaja mengutip lafal sahih “ath-thuhūru syathrul īmān”, bukan riwayat daif “an-nazhāfatu minal īmān”. Ketepatan sumber adalah prinsip kami.
QURANY · UMAT YANG MEMBACA
08 / 26
```


### Слайд 9

**Что было не так:**

- `Sebagian besar belum bisa.` — In English "Most still cannot" works because "Read" precedes it as an English verb. In Indonesian the first line ends on the Arabic «Iqra», so "belum bisa" has no verb to attach to and the sentence reads as unfinished. Indonesian needs the object clitic.
- `guru Pendidikan Agama Islam SD belum lancar membaca.` — The object is missing. As written, this says PAI teachers in primary schools 'are not yet fluent readers' — full stop, i.e. functionally illiterate. The claim is about reading Al-Qur'an. Presenting a slide to Kemenag that appears to accuse 58.3% of its own PAI teachers of not being able to read is a self-inflicted wound, and it also misrepresents the ANLDB figure.
- `65%
perkiraan pimpinan Dewan Masjid Indonesia.` — The number has no noun attached to it in either language: 65% of what? This is an unexplained figure sitting on a statistics slide, attributed to «pimpinan DMI» with a date range (2021–2022) but no statement of what it measures. Worse, it sits directly beside 53,6% — and if, as the DMI leadership actually said, the 65% also refers to Muslims who cannot read the Qur'an, then the slide presents two conflicting numbers for the same quantity with no reconciliation. An Indonesian expert will challenge this in the first ten seconds of Q&A, and the challenge will contaminate the credible figures next to it. Either state what the 65% measures and explain the gap, or cut the figure.
- `53,6%
Muslim dewasa di Indonesia belum bisa membaca Al-Qur'an.
Badan Pusat Statistik, Susenas 2018 — angka yang juga dikutip Kemenag` — Susenas is BPS's national socio-economic survey; it does not contain a Qur'an-literacy module, and BPS has never published a figure of 53,6% for buta aksara Al-Qur'an. The commonly circulated Indonesian figure of roughly 53–54% comes from IIQ/PTIQ Jakarta research and from Kemenag statements, not from BPS. Attributing it to BPS in a deck shown to Kemenag officials — the very institution that would know the provenance — is the fastest way to lose the room, and the deck has already staked its reputation on «ketepatan sumber adalah prinsip kami» two slides earlier. The hedge «angka yang juga dikutip Kemenag» does not repair a wrong primary attribution.
- `ANLDB, Kemenag, 2025` — «ANLDB» is not a recognised Indonesian acronym and appears garbled — the reader cannot verify it. Kemenag's relevant instruments are AKMI (Asesmen Kompetensi Madrasah Indonesia), ANBK (Asesmen Nasional Berbasis Komputer), or Balitbang Diklat Kemenag studies. A footnote whose source name does not exist reads as a fabricated citation, and it is carrying the deck's most provocative claim — that 58,3% of state primary-school Islamic Education teachers cannot read fluently. That claim will be contested by the teachers' associations; it needs a citation that survives a Google search.

**Было:**

```
MASALAH 04
Perintah pertama adalah «Iqra».
Sebagian besar belum bisa.
53,6%
Muslim dewasa di Indonesia belum bisa membaca Al-Qur’an.
Badan Pusat Statistik, Susenas 2018 — angka yang juga dikutip Kemenag
58,3% 65%
guru Pendidikan Agama Islam SD belum lancar perkiraan pimpinan Dewan Masjid Indonesia.
membaca.
ANLDB, Kemenag, 2025 DMI, 2021–2022
QURANY · UMAT YANG MEMBACA 09 / 26
```

**Стало (в Figma):**

```
MASALAH 04
Perintah pertama: “Iqra’”.
Sebagian besar umat belum bisa.
53,6%
umat Islam dewasa di Indonesia belum bisa membaca Al-Qur’an.
Badan Pusat Statistik, Susenas 2018 — angka yang juga dikutip Kemenag
58,3%
65%
guru Pendidikan Agama Islam SD belum lancar membaca Al-Qur’an.
belum bisa membaca Al-Qur’an, menurut perkiraan pimpinan Dewan Masjid Indonesia.
Kementerian Agama, 2025
DMI, 2021–2022
QURANY · UMAT YANG MEMBACA
09 / 26
```


### Слайд 10

**Что было не так:**

- `Catatan itu tersimpan pada perusahaan asing — yang
bertanggung jawab kepada pemegang sahamnya, tidak pernah kepada seorang
ulama.` — Three foreign fingerprints in one sentence: "tersimpan pada" (should be "di", or better "ada di tangan", which also echoes the memiliki headline); "tidak pernah kepada" is a literal "never to" where Indonesian uses "bukan kepada"; and "seorang ulama" imports the English indefinite article — Indonesian says "ulama mana pun" for this generic sense. The paragraph is also unusually long for a slide.

**Было:**

```
MASALAH 05
Siapa yang memiliki data umat,
memiliki umat.
2020 — MUSLIM PRO
Data lokasi pengguna Muslim — termasuk waktu salat dan pergerakan sehari-
hari — dilaporkan mengalir ke pialang data pihak ketiga. Perusahaannya
membantah dan memutus kerja sama itu. Presedennya tetap ada.
Aplikasi salat tahu kapan Anda salat, di mana Anda berada, dan apa yang Anda
baca tentang agama Anda. Catatan itu tersimpan pada perusahaan asing — yang
bertanggung jawab kepada pemegang sahamnya, tidak pernah kepada seorang
ulama.
QURANY · UMAT YANG MEMBACA 10 / 26
```

**Стало (в Figma):**

```
MASALAH 05
Siapa yang menguasai data umat,
dialah yang menguasai umat.
2020 — MUSLIM PRO
Data lokasi pengguna Muslim, termasuk waktu salat dan pergerakan sehari-hari, dilaporkan mengalir ke broker data pihak ketiga. Perusahaan tersebut membantah adanya pelanggaran dan memutus kerja sama itu. Namun preseden itu telanjur tercipta.
Aplikasi salat mengetahui kapan Anda salat, di mana Anda berada, dan apa saja yang Anda baca tentang agama. Catatan itu ada di tangan perusahaan asing — yang tunduk kepada pemegang sahamnya, bukan kepada ulama dan bukan kepada umat ini.
QURANY · UMAT YANG MEMBACA
10 / 26
```


### Слайд 11

**Что было не так:**

- `Pertama lewat aplikasi dan media. Setelah kepercayaan terkumpul — lewat
pendidikan.` — Two failures. "Kepercayaan terkumpul" is an unnatural collocation — Indonesian trust tumbuh or terbangun, it is never collected like donations. And the English's three-beat drumroll ("First the phone. Then the ground. Then the school.") has been flattened into one draggy sentence with no rhythm, on a chapter divider whose only job is rhythm.
- `Setelah kepercayaan terkumpul — lewat
pendidikan.` — «kepercayaan terkumpul» is a dead collocation — trust in Indonesian «tumbuh» or «terbangun», it is not «collected» like donations. The clause is also a verbless fragment. The same error is repeated on slide 19 («kepercayaan umat dan negeri ini terkumpul»), so it reads as a systematic mistranslation rather than a slip. «lewat» is the spoken form of «melalui» and should not sit in a chapter opener.
- `Pertama lewat aplikasi dan media. Setelah kepercayaan terkumpul — lewat pendidikan.` — The EN divider states the deck's spine in three beats: «First the phone. Then the ground. Then the school.» The ID collapses it into two and replaces «the ground» with «media». But «the ground» is the movement — the physical work in rivers, streets and mosques that slide 13 is entirely devoted to, and that slide 2 sells as pillar 02. Under the ID framing, the reader arrives at slide 13 with no slot to put it in, and the deck's most emotionally persuasive asset (creators doing real work in public) is demoted to a subcategory of media. The EN structure is materially stronger and matches the slides that follow it. The same collapse repeats on slide 19.

**Было:**

```
BAB 01
Solusi Kami
Pertama lewat aplikasi dan media. Setelah kepercayaan terkumpul — lewat
pendidikan. 01
QURANY · UMAT YANG MEMBACA 11 / 26
```

**Стало (в Figma):**

```
BAB 01
01
Jawaban Kami
Mulai dari aplikasi dan media. Lalu turun ke lapangan. Setelah kepercayaan tumbuh, masuk ke ruang kelas.
QURANY · UMAT YANG MEMBACA
11 / 26
```


### Слайд 12

**Что было не так:**

- `menutup khatam dengan sendirinya` — "By itself" rendered as "dengan sendirinya", which in Indonesian means "as a natural consequence / of its own accord" — not "automatically". As written it says the khatam closes spontaneously, which is the opposite of the claim (that the app does the work). Indonesian wants "otomatis".
- `Mulai dari yang paling dasar:
istiqamah.` — The English headline is a claim with an insight in it (istiqamah is easier together) — the whole reason the product exists. The Indonesian replaces it with throat-clearing: "let's start with the most basic thing". It is grammatical and completely inert. A deck headline that reads "fine" has failed.
- `fasil bisa beristirahat` — "Fasil" is campus/organisasi slang for fasilitator. In a deck for ulama, Kemenag officials and prospective muhsin it is jarringly casual — the equivalent of writing "admin" or "PJ" in a ministry proposal. It also loses the warmth of the English ("finally gets their evenings back"), which is the human payoff of the whole slide.
- `fasil bisa beristirahat` — 'Fasil' is campus-organisation slang for 'fasilitator' (BEM, LDK, training jargon). In a document read by MUI, Kemenag and DMI it is jarring at best and simply unparsed at worst, and it is the wrong word anyway: the person who runs an Indonesian tadarus group is the pengurus, admin grup, or the ustaz/ustazah who leads the majelis — never a 'fasil'. It is the single most obviously 'not written by a grown-up Indonesian institution' word in the deck.
- `grup tetap membaca, fasil bisa beristirahat` — «fasil» is clipped campus/organizer slang for fasilitator. In a deck addressed to MUI, Kemenag and DMI it reads like a WhatsApp message from a student committee; many readers over forty will simply not parse it. It is also inconsistent with the same slide's own «admin WhatsApp». Pick one register and one word for the role.
- `Satu juz sehari terasa berat kalau sendiri. Di dalam grup, ia
menjadi biasa.` — «kalau» is conversational; formal register takes «jika» or «bila». «sendiri» here should be «sendirian» (alone) — «sendiri» means «oneself/by oneself» and reads ambiguously. «Di dalam grup» is over-heavy; «dalam grup» suffices.

**Было:**

```
SOLUSI 01 · APLIKASI
Mulai dari yang paling dasar:
istiqamah.
Satu juz sehari terasa berat kalau sendiri. Di dalam grup, ia
menjadi biasa.
Hari ini grup tadarus di Indonesia berjalan lewat admin WhatsApp dan
spreadsheet. Qurany membagi juz, mencatat progres, dan menutup khatam
dengan sendirinya — grup tetap membaca, fasil bisa beristirahat.
Gratis selamanya Tanpa iklan Tanpa langganan
QURANY · UMAT YANG MEMBACA 12 / 26
```

**Стало (в Figma):**

```
JAWABAN 01 · APLIKASI
Istiqamah terasa ringan
bila dijalani bersama.
Satu juz sehari terasa berat bila sendirian. Di dalam grup, ia menjadi hal biasa.
Hari ini grup tadarus di Indonesia masih berjalan dengan admin WhatsApp dan spreadsheet. Qurany membagi juz, mencatat capaian, dan merapikan laporan khataman secara otomatis. Grup tetap membaca, dan pengurusnya tidak lagi sibuk mencatat — ia ikut membaca.
Gratis selamanya
Tanpa iklan
Tanpa langganan
QURANY · UMAT YANG MEMBACA
12 / 26
```


### Слайд 13

**Что было не так:**

- `kami ajarkan Al-Qur'an kepada mereka` — A Kazakh technology company telling an Indonesian audience that it teaches the Qur'an to Indonesian Muslims. This is the clearest arrogation of religious authority in the deck: 'kami ajarkan Al-Qur'an' places Qurany in the seat of the guru. Indonesian institutions never say this about themselves; they say they bring people to the ustaz. The deck is careful about ijazah and sanad elsewhere, then loses it here.
- `Preseden: Ant Forest — 500 juta pengguna mengubah kebiasaan digital menjadi ratusan juta pohon nyata.` — Ant Forest belongs to Ant Group / Alipay — a Chinese fintech, with all the associations that carries for an Indonesian religious audience (China, plus a lending-and-payments company whose model sits uneasily next to a slide about maisir and a deck that refuses a business model). Choosing a Chinese fintech gamification scheme as the moral precedent for a movement of the umat is an avoidable own goal, when Indonesia offers precedents this audience owns: Gerakan Pungut Sampah, sedekah sampah, DMI's mosque-cleanliness programmes, or the way tadarus culture itself spreads each Ramadan. Also 'Preseden' is legal-register jargon (and on slide 10 it labels a bad precedent, here a good one).

**Было:**

```
SOLUSI 02 · GERAKAN
Umat tidak berubah karena diimbau.
Umat berubah karena ada yang dicontoh.
Kami kumpulkan kreator Muslim Indonesia, kami ajarkan Al-Qur’an kepada mereka,
lalu kami jalankan proyek sosial bersama — mereka yang mengerjakan lebih dulu, di
depan kamera.
01 Kreator mengerjakan Bukan mengajak dari balik layar. Mereka
hadir di lokasi dan ikut bekerja bersama
jamaah.
02 Umat melihat dan ikut Setiap aksi direkam, dibagikan, lalu
ditantangkan ke kota berikutnya.
03 Kebiasaan menetap Yang tadinya kampanye berubah menjadi
rutinitas jamaah — tanpa kami.
Preseden: Ant Forest — 500 juta pengguna mengubah kebiasaan digital menjadi ratusan juta pohon
nyata.
QURANY · UMAT YANG MEMBACA 13 / 26
```

**Стало (в Figma):**

```
JAWABAN 02 · GERAKAN
Umat tidak berubah karena diimbau.
Umat berubah karena ada yang dicontoh.
Kami himpun kreator-kreator Muslim terbesar di Indonesia, kami dampingi mereka belajar Al-Qur’an kepada para ustaz, lalu kami jalankan kegiatan sosial bersama mereka. Mereka lebih dulu turun tangan, di depan kamera, disaksikan jutaan orang.
Kreator mengerjakan
Bukan mengajak dari balik layar. Mereka hadir di lokasi dan ikut bekerja bersama jemaah.
01
Umat melihat dan ikut
Setiap kegiatan direkam dan dibagikan, lalu kota berikutnya menerima tantangan yang sama.
02
Kebiasaan mengakar
Yang tadinya kampanye kini menjadi rutinitas jemaah — tanpa kami.
03
Umat percaya kepada yang lebih dulu mengerjakan. Contoh nyata: sedekah sampah dan kerja bakti di masjid — dimulai segelintir orang, kini menjadi rutinitas jemaah di banyak daerah.
QURANY · UMAT YANG MEMBACA
13 / 26
```


### Слайд 14

**Что было не так:**

- `Setiap pekan satu ayat diterjemahkan
menjadi satu amalan yang bisa dikerjakan
hari itu juga.` — "Diterjemahkan menjadi" is the English metaphor "translated into" taken literally. In Indonesian diterjemahkan means linguistic translation almost exclusively — and with an ayah as its object it actively suggests you are translating the Qur'an into an amal, which is confusing at best and careless at worst before this audience.
- `Perangkat yang tadinya mengambil waktu
umat kini mengantar mereka masuk ke
Qurany.` — "Mengambil waktu" is the standard Indonesian idiom for "takes a while / is time-consuming" — so the sentence reads "a device that used to be time-consuming". The intended meaning (the phone stole the ummah's time) needs merampas or menyita. This is a genuine meaning collision, not just a stylistic one.
- `Setiap pekan satu ayat diterjemahkan menjadi satu amalan yang bisa dikerjakan hari itu juga.` — The English carried the single most reassuring sentence in the whole deck — 'Chosen with the ulama. Short, clear, never a fiqh dispute.' — and the Indonesian deleted it. To MUI, a media operation that turns one ayat per week into one action is either a dakwah programme under ulama supervision or an unlicensed mufti with 36 million followers; that sentence was what decided which. Its absence is the biggest content loss in the translation. Secondary point: 'ayat diterjemahkan menjadi amalan' collides with tarjamah Al-Qur'an, since 'menerjemahkan ayat' has a fixed technical meaning.
- `01 Satu ayat → satu amalan Setiap pekan satu ayat diterjemahkan
menjadi satu amalan yang bisa dikerjakan
hari itu juga.` — The ID drops the EN's «Chosen with the ulama. Short, clear, never a fiqh dispute.» On the media slide — the one place where MUI will ask «who decides which ayah, and who guards against khilafiyah?» — the ID version answers neither. Also «diterjemahkan menjadi» is wrong: an ayah is not «translated into» an action; Indonesian says «diturunkan menjadi». 
- `01 Satu ayat → satu amalan Setiap pekan satu ayat diterjemahkan menjadi satu amalan yang bisa dikerjakan hari itu juga.` — The EN item reads «One ayah — Chosen with the ulama. Short, clear, never a fiqh dispute.» The ID drops both halves of that: the ulama are no longer named as the ones who choose the ayah, and the promise to stay away from khilafiyah is gone entirely. For an audience of MUI and Kemenag, this is the single most important sentence in the whole deck — it is the answer to the first question they will ask («siapa yang memilih ayatnya, dan bagaimana kalau masuk wilayah khilafiyah?»). The ID version instead makes an unqualified operational promise («satu ayat setiap pekan, dikerjakan hari itu juga») with no scholarly gatekeeper attached to it. This is the most serious omission in the translation.

**Было:**

```
SOLUSI 03 · MEDIA
Enam jam itu
bisa berpindah tangan.
Waktu layar tidak akan hilang. Ia hanya bisa dialihkan.
01 Satu ayat → satu amalan Setiap pekan satu ayat diterjemahkan
menjadi satu amalan yang bisa dikerjakan
hari itu juga.
02 Dikerjakan, bukan dikutip Kreator mengerjakannya lebih dulu; umat
mengirim buktinya sendiri.
03 Layar yang mengembalikan Perangkat yang tadinya mengambil waktu
umat kini mengantar mereka masuk ke
Qurany.
Membaca itu awal. Praktik itu tujuannya.
QURANY · UMAT YANG MEMBACA 14 / 26
```

**Стало (в Figma):**

```
JAWABAN 03 · MEDIA
Enam jam itu
bisa berpindah tangan.
Waktu layar tidak akan hilang. Ia hanya bisa dialihkan.
Satu ayat → satu amalan
Ayat dipilih bersama para ulama: ringkas, jelas, dan tidak menyentuh perkara khilafiyah. Setiap pekan satu ayat menjadi satu amalan hari itu juga.
01
Dikerjakan, bukan dikutip
Kreator mengerjakan amalan itu lebih dulu di depan kamera, lalu jemaah mengulanginya di masjid masing-masing.
02
Layar yang menuntun kembali
Perangkat yang tadinya merampas waktu umat kini mengantar mereka kepada Al-Qur’an, melalui Qurany.
03
Membaca itu awal. Mengamalkan itu tujuannya.
QURANY · UMAT YANG MEMBACA
14 / 26
```


### Слайд 15

**Что было не так:**

- `Pindai wajah dan bertanding langsung.` — The English says the face scan exists 'to identify the gender' — i.e. to make sure a young man is matched against a young man and a young woman against a young woman. That reason is the only thing that makes a biometric feature acceptable to this audience, and the Indonesian drops it entirely. What remains is 'scan your face' — five slides after the deck attacked Muslim Pro for harvesting users' data. Ulama will hear both ikhtilat and surveillance in one line.
- `latihan tartil dengan koreksi tajwid oleh AI — bukan ijazah` — Two register failures in one clause. 'Koreksi tajwid oleh AI' asserts that the machine corrects tajwid — i.e. holds the authority to judge a recitation, which belongs to a guru; the English was deliberately weaker ('feedback on tajweed'). And 'bukan ijazah' is too elliptical to do its job: 'ijazah' in everyday Indonesian first means a school diploma, so the reader parses 'you won't get a certificate' rather than the intended 'this does not confer sanad'. The formulation on slide 20 ('Teknologi tidak pernah memberi ijazah') is correct and should be the template for all three occurrences.
- `03 Qurany PVP Pindai wajah dan bertanding langsung.` — Two problems stacked. (1) The EN original says «Scan your face to identify the gender and go head to head» — a biometric gender-classification feature. Under UU PDP No. 27/2022 face data is *data pribadi spesifik* requiring explicit separate consent, so this feature directly contradicts the deck's own privacy argument on slide 10 («siapa yang memiliki data umat, memiliki umat») and its own legality claim on slide 22. A Kemenag or MUI reader will notice the contradiction across three slides. (2) The ID translation drops the *reason* for the scan (gender separation) while keeping the scan itself, so the reader is left with an app that scans your face for no stated purpose — the worst of both options. If the intent is ikhtilat avoidance, say so and drop the biometrics; if not, drop the face scan from the deck entirely.
- `01 Qurany Duolingo` — Duolingo is a registered trademark of Duolingo, Inc. Using it as the name of your own product, in a document circulated to a ministry, to MUI and to corporate donors, is a legal exposure and reads as unserious — it tells the reader the product has no name yet and that the team borrowed someone else's. It also undercuts the sovereignty argument the deck makes on slide 10 (foreign companies should not own the ummah's practice). The same problem is carried into the ID on slides 15 and 16 unchanged; if the EN uses it as internal shorthand, that shorthand should never have survived into a published deck in either language.

**Было:**

```
RENCANA PRODUK
Membaca harus diajarkan
sebelum menjadi kebiasaan.
Hari ini Qurany menemani mereka yang sudah bisa membaca. Tiga hal ini
membentuk yang belum bisa — dan memberi yang sudah bisa alasan untuk
kembali.
01 Qurany Duolingo Belajar membaca Al-Qur’an dari huruf
pertama, dalam langkah pendek setiap
hari.
02 Qurany Recite Anda membaca, aplikasi mendengarkan:
latihan tartil dengan koreksi tajwid oleh AI
— bukan ijazah.
03 Qurany PVP Pindai wajah dan bertanding langsung.
Kompetisi itulah yang membuat anak muda
membuka aplikasi lagi besok.
QURANY · UMAT YANG MEMBACA 15 / 26
```

**Стало (в Figma):**

```
PETA JALAN PRODUK
Membaca harus diajarkan
sebelum menjadi kebiasaan.
Hari ini Qurany menemani mereka yang sudah bisa membaca. Tiga langkah berikut menyiapkan mereka yang belum bisa, sekaligus memberi alasan bagi yang sudah bisa untuk kembali.
Qurany Iqra’
Belajar membaca Al-Qur’an dari huruf pertama, dengan langkah-langkah pendek setiap hari.
01
Qurany Recite
Anda membaca, aplikasi mendengarkan: latihan tartil dengan masukan tajwid dari AI. Ijazah tetap dari guru, bukan dari aplikasi.
02
Qurany Musabaqah
MTQ dalam genggaman. Wajah dipindai hanya untuk memastikan lawan tanding sesama jenis, dan hasil pindaian tidak disimpan. Semangat berlomba itulah yang membuat anak muda membuka aplikasi ini lagi besok.
03
QURANY · UMAT YANG MEMBACA
15 / 26
```


### Слайд 16

**Что было не так:**

- `Kursus yang dimulai dari titik orang itu benar-benar berada` — A literal rendering of "starts where the person actually is", transposed morpheme by morpheme. "Dari titik orang itu benar-benar berada" is not a construction Indonesian has — it is missing a relativiser and reads as broken. Also "Kursus" is course-vendor vocabulary; a deck for Kemenag would say kelas or program belajar.
- `Mereka tidak butuh mushaf lagi — mereka butuh jalannya.` — The English meant 'they do not need another mushaf'. The Indonesian, with 'lagi' after the negation, is readily read as 'they no longer need the mushaf' — a sentence about the mushaf that no one should have to explain away in front of ulama. The risk is asymmetric: the intended meaning gains nothing, the misreading is unforgivable.
- `Kursus yang dimulai dari titik orang itu benar-benar berada` — Ungrammatical: a relative clause of place needs «tempat» (or «di mana» in loose style) — «dari titik orang itu berada» has no linking element and stops the reader mid-sentence. This is the body copy's opening clause.
- `Mereka tidak butuh mushaf lagi — mereka butuh jalannya.` — The EN reads «They do not need another mushaf — they need a path», i.e. one more printed copy is not what is missing. «Tidak butuh mushaf lagi» in Indonesian reads most naturally as «they no longer need a mushaf» — a statement that Muslims have finished with the Qur'anic text. Said to ulama, to DMI, and to the people who fund mushaf distribution programmes, this is close to unforgivable, and it is a pure translation accident: one misplaced *lagi*. It also insults the mushaf-wakaf programmes that many of the muhsin in the room personally fund.

**Было:**

```
PRODUK 01 · QURANY DUOLINGO
Dari huruf pertama
9:41 Hari 7
3/8
‹
menuju surah pertama.
Separuh negeri ini belum bisa membaca Al-Qur’an. Mereka
‫َب‬
tidak butuh mushaf lagi — mereka butuh jalannya.
Huruf apa ini?
Kursus yang dimulai dari titik orang itu benar-benar berada: huruf, lalu harakat, lalu
menyambungnya, lalu surah-surah pendek pertama. Lima sampai sepuluh menit ba
sehari, dengan jalur terpisah untuk anak-anak dan untuk orang dewasa yang dulu
tidak sempat. ta
nun
Mulai dari nol 5–10 menit sehari Disusun bersama ulama
Benar — tiga berturut-turut
Lanjut
QURANY · UMAT YANG MEMBACA 16 / 26
```

**Стало (в Figma):**

```
PRODUK 01 · QURANY IQRA’
Dari huruf pertama
menuju surah pertama.
9:41
Hari 7
‹
3 / 8
بَ
Separuh umat Islam dewasa belum bisa membaca Al-Qur’an. Yang mereka perlukan bukan mushaf baru, melainkan jalannya.
Kelas yang berangkat dari kemampuan peserta apa adanya: huruf, harakat, huruf sambung, hingga surah-surah pendek pertama. Lima sampai sepuluh menit sehari, dengan jalur terpisah untuk anak-anak dan untuk orang dewasa yang dahulu belum sempat belajar.
Huruf apa ini?
ba
ta
nun
Mulai dari nol
5–10 menit sehari
Disusun bersama ulama
Benar, tiga kali berturut-turut
Lanjut
QURANY · UMAT YANG MEMBACA
16 / 26
```


### Слайд 17

**Что было не так:**

- `Bagian yang sulit
adalah melafalkannya setiap hari, dengan suara.` — ", dengan suara" tacked on at the end is English appositive rhythm rendering "out loud" — in Indonesian it lands as a limp afterthought and is also ambiguous (with sound? aloud? with one's own voice?). Indonesian puts the manner adverb inside the phrase: "melafalkannya keras-keras".
- `menandai di mana bacaan
tergelincir` — "Di mana" as a relative pronoun again (calque of "where"), plus an unnatural collocation: bacaan does not tergelincir in Indonesian — tergelincir is used for feet, vehicles, and morally for a person's slip. Applied to a recitation it sounds like clumsy poetry rather than a product description.
- `Ia tidak pernah
menggantikan ustaz.` — The English carries the argument that actually reassures an ulama audience — "An ustaz cannot sit with every student daily. This fills the days in between." The Indonesian cuts it and keeps only the bare disclaimer, which now reads defensively rather than deferentially. This is a divergence from the EN that loses something important on the slide where deference matters most.
- `Ia tidak pernah menggantikan ustaz.` — The sentence survives, but the reasoning that made it persuasive was cut. The English said: an ustaz cannot sit with every student every day; this fills the days in between; it never replaces the ustaz. That is the argument that turns the claim from a disclaimer into a show of deference — it explains what role the tool actually occupies in the traditional teaching relationship. Without it, 'Ia tidak pernah menggantikan ustaz' reads as a legal caveat bolted on after the fact.
- `Ia tidak pernah menggantikan ustaz.` — The EN gives the reasoning before the denial: «An ustaz cannot sit with every student daily. This fills the days in between; it never replaces the ustaz.» The ID keeps only the bare denial. For ulama and pesantren partners, the reasoning is the entire persuasive load — it positions the AI in the gap *between* talaqqi sessions rather than in competition with the teacher, and it flatters rather than threatens the ustaz. Stripped of it, «tidak pernah menggantikan ustaz» reads as a defensive disclaimer bolted onto a product that plainly does the ustaz's job, which is exactly the reading the sentence was written to prevent.

**Было:**

```
PRODUK 02 · QURANY RECITE
Anda membaca.
9:41 An-Nas · 1
Recite
Aplikasi mendengarkan. ‫ِساَّنلٱ ِّبَرِب ُذوُعَأ ْلُق‬
madd kurang panjang · ghunnah bersih
Mengenal huruf itu bagian yang mudah. Bagian yang sulit
adalah melafalkannya setiap hari, dengan suara.
Recite mengikuti Anda ayat demi ayat secara tartil dan menandai di mana bacaan
tergelincir — madd yang kurang panjang, ghunnah yang terlewat, huruf yang keluar
dari makhrajnya — lalu menunjukkan apa yang harus diulang besok. Ia tidak pernah mendengarkan…
menggantikan ustaz.
Madd pendek
Ghunnah bersih
Tartil, ayat demi ayat Koreksi tajwid Bukan ijazah
Makhraj bersih
Ulangi kata yang ditandai
QURANY · UMAT YANG MEMBACA 17 / 26
```

**Стало (в Figma):**

```
PRODUK 02 · QURANY RECITE
Anda membaca.
Aplikasi mendengarkan.
9:41
An-Nas · 1
Recite
قُلْ أَعُوذُ بِرَبِّ ٱلنَّاسِ
mad pendek · gunnah sempurna
Mengenal huruf itu bagian yang mudah. Yang sulit adalah melafalkannya dengan lantang, setiap hari.
Recite mengikuti Anda ayat demi ayat secara tartil dan menandai bagian mana yang keliru: mad yang kurang panjang, gunnah yang terlewat, huruf yang keluar dari makhrajnya, lalu menunjukkan apa yang perlu diulang besok. Seorang ustaz tidak mungkin mendampingi setiap murid setiap hari. Recite menemani murid pada hari-hari di antara dua pertemuan, dan tidak pernah menggantikan gurunya.
mendengarkan…
Mad
pendek
Gunnah
sempurna
Tartil, ayat demi ayat
Masukan tajwid
Bukan ijazah
Makhraj
tepat
Ulangi kata yang ditandai
QURANY · UMAT YANG MEMBACA
17 / 26
```


### Слайд 18

**Что было не так:**

- `Enam jam itu milik aplikasi yang dirancang untuk dilombakan.` — "Dirancang untuk dilombakan" says the apps are designed to be entered into a competition — as if they were contest entries. The meaning needed is that they are built around competition to hook users. The passive dilombakan puts the app in the wrong grammatical role entirely.
- `Dua pemain masuk dengan pindai wajah dan bertanding langsung` — The EN says the face scan is there «to identify the gender» — i.e. so that opponents are matched same-gender. The ID drops the reason entirely, on both slide 15 and slide 18. Two consequences with this audience: (a) the ikhtilat safeguard that would reassure ulama is invisible, and (b) coming eight slides after «Siapa yang memiliki data umat, memiliki umat», an unexplained face scan reads as precisely the privacy risk the deck just condemned. This is the most costly omission in the ID deck.

**Было:**

```
PRODUK 03 · QURANY PVP
Alasan mereka membukanya
9:41 Ronde 3 / 5
lagi besok. Anda
2
0 : 14
detik tersisa Ridwan
1
Enam jam itu milik aplikasi yang dirancang untuk dilombakan.
Aplikasi Al-Qur’an yang mengabaikannya akan kalah. ‫ِساَوْسَوْلٱ ِّرَش نِم‬
Hukum apa yang berlaku pada huruf
bertanda?
Dua pemain masuk dengan pindai wajah dan bertanding langsung — ronde
singkat bacaan dan tajwid. Perlombaan hanya terjadi antara mereka yang memilih
untuk ikut, dan tidak pernah menjadi peringkat ketakwaan: poin bukan pahala, Idgham
ganjaran hanya ada pada Allah.
Ikhfa
Pindai wajah Ronde singkat Poin bukan pahala Qalqalah
Poin bukan pahala.
Jawab
QURANY · UMAT YANG MEMBACA 18 / 26
```

**Стало (в Figma):**

```
PRODUK 03 · QURANY MUSABAQAH
Alasan mereka membuka
Qurany lagi besok.
9:41
Ronde 3/5
0:14
Anda
Ridwan
detik tersisa
2
1
Enam jam itu dikuasai aplikasi yang hidup dari perlombaan. Aplikasi Al-Qur’an yang mengabaikannya akan ditinggalkan.
مِن شَرِّ ٱلْوَسْوَاسِ
Hukum bacaan apa yang berlaku pada huruf bertanda?
Dua pemain masuk melalui pemindaian wajah, hanya untuk memastikan lawan tanding sesama jenis. Hasil pindaian tidak disimpan. Keduanya lalu berlomba dalam ronde singkat bacaan dan tajwid. Perlombaan hanya berlangsung di antara mereka yang memilih untuk ikut, dan tidak pernah menjadi peringkat ketakwaan: poin bukan pahala, pahalanya ada di sisi Allah semata.
Idgham
Ikhfa
Pindai wajah
Ronde singkat
Poin bukan pahala
Qalqalah
Poin bukan pahala.
Jawab
QURANY · UMAT YANG MEMBACA
18 / 26
```


### Слайд 19

**Что было не так:**

- `Setelah kepercayaan umat dan negeri ini terkumpul — kami
membangun pendidikannya.` — "Kepercayaan ... terkumpul" repeats the slide 11 collocation error — trust is not collected in Indonesian. "Kepercayaan negeri ini" is also odd (a country does not have kepercayaan; it gives it). And "membangun pendidikannya" with the bare -nya is vague — whose education? Indonesian wants a concrete object.
- `Rencana Ke Depan` — Capitalization error in Indonesian title case: prepositions (di, ke, dari), conjunctions and particles stay lowercase unless they open the title. «Ke» here is a preposition. This is the first thing an Indonesian editor's eye lands on, and it sits on a chapter title in 60pt.

**Было:**

```
BAB 02
Rencana Ke Depan
02
Aplikasi dan media adalah pintunya. Setelah kepercayaan umat dan negeri ini terkumpul — kami
membangun pendidikannya.
QURANY · UMAT YANG MEMBACA 19 / 26
```

**Стало (в Figma):**

```
BAB 02
02
Rencana Kami
Aplikasi, media, dan gerakan di lapangan adalah pintu masuk. Setelah kepercayaan umat dan negara tumbuh, barulah kami melangkah ke ruang kelas.
QURANY · UMAT YANG MEMBACA
19 / 26
```


### Слайд 20

**Что было не так:**

- `02 Amal yang tercatat` — 'Amal yang tercatat' points straight at catatan amal and the two recording angels. An application that presents itself as the thing which records a student's amal is stepping into territory that belongs to Raqib and Atid, and the phrasing quantifies worship in exactly the way the deck elsewhere works hard to avoid. Note that the English was consciously careful — 'Deeds logged, not counted' — and the Indonesian dropped the 'not counted' guard.
- `Anak yang bisa membaca tapi belum bisa berakhlak, belum selesai dididik.` — «tapi» is the spoken contraction; formal written Indonesian requires «tetapi» (mid-sentence) or «namun» (sentence-initial). Compounding it, «belum bisa berakhlak» is unidiomatic — akhlak is not an ability one is «able» to do; you say «belum berakhlak» or «belum terdidik akhlaknya».

**Было:**

```
RENCANA 01 · SEKOLAH
Sekolah yang mengajarkan Islam
lewat praktik, bukan hafalan semata.
Anak yang bisa membaca tapi belum bisa berakhlak, belum selesai dididik.
01 Adab sebelum ilmu Akhlak diajarkan oleh guru yang
menjalankannya.
02 Amal yang tercatat Yang dipraktikkan pekan ini — bukan yang
dihafal.
03 Talaqqi dijaga Sanad tetap dari guru. Teknologi tidak
pernah memberi ijazah.
QURANY · UMAT YANG MEMBACA 20 / 26
```

**Стало (в Figma):**

```
RENCANA 01 · SEKOLAH QURANY
Sekolah yang mengajarkan Islam
untuk diamalkan, bukan dihafalkan.
Anak yang bisa membaca tetapi belum berakhlak, belum selesai dididik. Separuh yang hilang itulah yang kami kembalikan ke dalam kurikulum.
Adab sebelum ilmu
Akhlak dinilai lebih dahulu daripada materi pelajaran, oleh guru yang menjalankannya, bukan hanya mengajarkannya.
01
Amal yang dijalani, bukan yang dihitung
Apa yang benar-benar dikerjakan murid pekan ini, dibuktikan di sekolah, bukan hafalan yang disetorkan.
02
Talaqqi dijaga
Sanad tetap bersambung melalui guru. Teknologi tidak pernah memberi ijazah.
03
QURANY · UMAT YANG MEMBACA
20 / 26
```


### Слайд 21

**Что было не так:**

- `adalah bagian dari agama ini, bukan gangguan darinya.` — "Bukan gangguan darinya" is "not a distraction from it" translated word by word and is meaningless in Indonesian — gangguan darinya would mean "interference coming from it". This is the closing line of the boldest claim in the deck (that wealth is not un-Islamic), so it fails at the exact moment it needs to land.
- `termasuk cara berusaha,
membuka lapangan kerja, dan menguatkan ekonomi negeri ini.` — "Cara berusaha" is genuinely ambiguous in Indonesian: the default reading of berusaha is "to try / to make an effort", so the line first parses as "how to try harder". Only the following clause disambiguates it toward business. On a slide about a university curriculum this is a real comprehension stumble.
- `Di antara sepuluh sahabat yang dijanjikan surga terdapat saudagar-saudagar terkaya pada
zamannya.` — The fixed Indonesian term for al-'asyarah al-mubasyarah bil jannah is «sepuluh sahabat yang dijamin masuk surga». «dijanjikan surga» is a literal translation of the English and immediately marks the writer as someone outside the Indonesian Islamic-publishing tradition — in front of the one audience that uses the set phrase daily.
- `Kekuatan — materi, ruhani, dan fisik — adalah bagian dari agama ini, bukan
gangguan darinya.` — Two errors. (1) The triplet is not parallel: «materi» is a noun, «ruhani» and «fisik» are adjectives — you cannot coordinate them. Indonesian pairs «rohani» with «jasmani», and KBBI's standard spelling is «rohani», not «ruhani». (2) «bukan gangguan darinya» is a calque of «not a distraction from it»; «gangguan dari» is not Indonesian in this sense.

**Было:**

```
RENCANA 02 · KAMPUS
Dari sekolah
menuju kampus.
Kami akan mengajarkan Al-Qur’an sebagai praktik — termasuk cara berusaha,
membuka lapangan kerja, dan menguatkan ekonomi negeri ini.
Menjadi Muslim yang baik
tidak pernah berarti harus miskin.
Di antara sepuluh sahabat yang dijanjikan surga terdapat saudagar-saudagar terkaya pada
zamannya. Kekuatan — materi, ruhani, dan fisik — adalah bagian dari agama ini, bukan KAMPUS QURANY · RENDER
gangguan darinya.
QURANY · UMAT YANG MEMBACA 21 / 26
```

**Стало (в Figma):**

```
RENCANA 02 · UNIVERSITAS QURANY
Dari sekolah
menuju universitas.
Kami akan mengajarkan Al-Qur’an untuk diamalkan: cara membangun usaha, membuka lapangan kerja, dan menguatkan ekonomi negeri ini. Ini rencana jangka panjang yang kami tempuh melalui jalur perizinan resmi.
Menjadi Muslim yang baik
tidak pernah berarti harus hidup miskin.
Di antara sepuluh sahabat radhiyallahu ‘anhum yang dijamin masuk surga terdapat saudagar-saudagar terkaya pada zamannya. Kekuatan harta, rohani, dan jasmani adalah bagian dari agama ini, bukan penghalangnya.
UNIVERSITAS QURANY · RENDER
QURANY · UMAT YANG MEMBACA
21 / 26
```


### Слайд 22

**Что было не так:**

- `data disimpan di Indonesia sesuai UU PDP No. 27/2022.` — Indonesian legal citation is reversed and truncated. The statute is cited as «UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi» — number first, «Tahun» spelled out, subject named; the acronym follows in parentheses. Note also the official title uses «Pelindungan», not «Perlindungan». For a slide whose whole point is legal credibility before Kemenag and a yayasan regulator, mis-citing the law undoes the slide. On the same line, «izin PUB» is an unexpanded acronym and «sebelum penggalangan» is incomplete.
- `Aplikasi, gerakan, kampus, dan sekolah — semuanya dibiayai dengan satu cara. Muhsin: individu atau perusahaan yang sedekah jariahnya menjaga semua ini tetap gratis.` — This sentence exists nowhere in the EN, which limits the sadaqah model to «the app free and the programmes running». The ID extends it to a university and a network of schools and promises that all of them stay *gratis*, funded entirely by donations. That is an enormous financial commitment the team cannot underwrite — a free accredited university in Indonesia is a multi-hundred-billion-rupiah annual obligation — and it is stated flatly, in a governance section, next to a claim of external audit. A muhsin or a Kemenag official will read it as a binding representation. Worse, it contradicts slide 21, which frames the university around teaching people to build businesses and generate income.
- `Muhsin: individu atau perusahaan yang sedekah jariahnya menjaga semua ini tetap gratis.` — The EN itemises exactly what the donation covers: «servers, development, and the cleanliness work in mosques and neighbourhoods». The ID drops the itemisation entirely and leaves only «menjaga semua ini tetap gratis». On a slide whose whole job is to convert a muhsin, the specificity *is* the pitch — an Indonesian donor asked for regular sedekah jariah wants to know which line items his money touches, and «semua ini» is exactly the vagueness that makes serious donors decline. The transparency claim in the next column becomes hollow when the slide itself will not name the cost categories.

**Было:**

```
MODEL & TATA KELOLA
Tanpa model bisnis.
Model sedekah jariah.
Aplikasi, gerakan, kampus, dan sekolah — semuanya dibiayai dengan satu cara. Muhsin: individu SAHIH MUSLIM, 1631
atau perusahaan yang sedekah jariahnya menjaga semua ini tetap gratis.
Yang kami terima Transparansi Legalitas
Sedekah, infak, wakaf — tidak pernah zakat. Setiap rupiah tampil di dasbor publik. Audit eksternal Yayasan Indonesia; izin PUB sebelum penggalangan;
setiap tahun. data disimpan di Indonesia sesuai UU PDP No. 27/2022.
Preseden: Wikipedia — situs sepuluh besar dunia, tanpa iklan, dua dekade hidup dari donasi.
QURANY · UMAT YANG MEMBACA 22 / 26
```

**Стало (в Figma):**

```
MODEL DAN TATA KELOLA
Ini bukan model bisnis.
Ini model sedekah jariah.
Muhsin berarti “orang yang berbuat baik”: perseorangan dan perusahaan yang sedekah jariahnya menjaga aplikasi ini tetap gratis — biaya server, pengembangan produk, dan kerja kebersihan di masjid. Sekolah dan universitas dibiayai tersendiri.
HR Muslim, no. 1631
Yang kami terima
Transparansi
Legalitas
Sedekah, infak, dan wakaf — bukan zakat.
Setiap rupiah tercatat di laman transparansi publik dan diperbarui secara langsung. Audit eksternal setiap tahun.
Berbadan hukum yayasan Indonesia. Izin Pengumpulan Uang atau Barang (PUB) dari Kementerian Sosial diperoleh sebelum penggalangan dana publik. Data disimpan di Indonesia sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP).
Contoh nyata: Wikipedia — situs sepuluh besar dunia, tanpa iklan, dua dekade hidup dari donasi.
QURANY · UMAT YANG MEMBACA
22 / 26
```


### Слайд 23

**Было:**

```
BAB 03
Kenapa Kami
03
Karena bagian tersulitnya sudah pernah kami kerjakan di tempat lain.
QURANY · UMAT YANG MEMBACA 23 / 26
```

**Стало (в Figma):**

```
BAB 03
03
Mengapa Kami
Karena bagian tersulit sudah kami kerjakan di tempat lain.
QURANY · UMAT YANG MEMBACA
23 / 26
```


### Слайд 24

**Что было не так:**

- `serta menjadi mitra kementerian dalam proyek komunikasi
nasional.` — The EN specifies «Kazakh ministries». Unqualified «kementerian» on a slide read in Jakarta will be understood as Indonesian ministries — an overclaim the company cannot support and one that, if noticed later, destroys trust with the exact officials being addressed. The nationality must be explicit.
- `serta menjadi mitra kementerian dalam proyek komunikasi nasional.` — The EN says «partner with Kazakh ministries on national projects». The ID drops the word Kazakh. Read by an Indonesian audience — in a deck full of Indonesian institutions, presented to Kemenag — «mitra kementerian dalam proyek komunikasi nasional» will be understood as partnership with *Indonesian* ministries. That is a misrepresentation of institutional standing to a government audience, the kind of thing that ends a relationship when discovered. The ID also narrows «national projects» to «proyek komunikasi», which is a smaller claim, but the missing nationality is the real problem.

**Было:**

```
KENAPA KAMI 01
Kami menggerakkan
perhatian sebuah negeri.
60
akun media milik sendiri
36 jt+
pengikut di seluruh platform
860 jt
tayangan konten per bulan
GALAMAT MEDIA · bee16 GALAMAT TECH
Jaringan media digital terbesar di Kazakhstan. Kami memegang akun @qazaqstan — akun Perusahaan produk dari grup yang sama — dan pengembang Qurany.
yang membawa nama negara — serta menjadi mitra kementerian dalam proyek komunikasi
nasional.
Keahlian kami adalah mengumpulkan audiens puluhan juta. Di Qurany, keahlian itu kami arahkan untuk umat.
QURANY · UMAT YANG MEMBACA 24 / 26
```

**Стало (в Figma):**

```
MENGAPA KAMI · GALAMAT
Kami menggerakkan
perhatian satu negeri.
60
36 juta
860 juta
akun media milik kami sendiri
pengikut di seluruh platform
tayangan konten per bulan
GALAMAT MEDIA · bee16
GALAMAT TECH
Grup media digital terbesar di Kazakhstan. Kami mengelola dan mengembangkan akun @qazaqstan, akun yang membawa nama negara itu, serta menjadi mitra kementerian-kementerian Republik Kazakhstan dalam proyek-proyek nasional.
Perusahaan produk dan teknologi dari grup yang sama, sekaligus pengembang Qurany.
Keahlian kami adalah menghimpun perhatian puluhan juta orang. Di Qurany, keahlian itu kami abdikan untuk umat.
QURANY · UMAT YANG MEMBACA
24 / 26
```


### Слайд 25

**Что было не так:**

- `Kami mengirim produk,
bukan presentasi.` — "We ship products" translated literally. In Indonesian "mengirim produk" means physically dispatching goods — it reads as a logistics company. The headline is meant to be the proudest line on the slide and instead sounds like a courier service.
- `150 000+ No. 1 1 000 000+` — Thousands separated by a space. Indonesian uses a period as the thousands separator and a comma as the decimal separator — and the deck already does this correctly on slide 7 («603.000»), so the same document uses two mutually exclusive conventions. Same error on «35 000+» lower on this slide.
- `Kami mengirim produk,
bukan presentasi.` — Literal calque of «we ship products». In Indonesian «mengirim produk» means physically dispatching goods — a courier, not a software company. This is the headline of the credibility slide and it reads as machine output.

**Было:**

```
KENAPA KAMI 02
Kami mengirim produk,
bukan presentasi.
REDart
Editor foto dan video berbasis preset kreator.
150 000+ No. 1 1 000 000+
unduhan di iOS dan Android Foto & Video — App Store KZ foto dan video diproses
iTalent · italent.kz
Asesmen kekuatan diri untuk memilih arah belajar dan
35 000+ 15 menit Ru / En
karier. orang sudah mengikuti untuk satu asesmen lengkap untuk anak muda
Pengguna pertama kami datang lewat komunitas, bukan lewat iklan. Di Indonesia, komunitas itu adalah masjid, majelis taklim, dan para ustaz.
QURANY · UMAT YANG MEMBACA 25 / 26
```

**Стало (в Figma):**

```
MENGAPA KAMI · REKAM JEJAK
Kami merilis produk,
bukan presentasi.
REDart
150.000+
No. 1
1.000.000+
Editor foto dan video berbasis preset kreator.
unduhan di iOS dan Android
Foto & Video — App Store KZ
foto dan video diproses
iTalent · italent.kz
35.000+
15 menit
Rusia/Inggris
Asesmen kekuatan diri untuk memilih arah belajar dan karier.
orang sudah mengikutinya
untuk satu asesmen lengkap
untuk anak muda
Pengguna pertama kami datang melalui komunitas, bukan iklan. Di Indonesia, komunitas itu adalah masjid, majelis taklim, dan para ustaz.
QURANY · UMAT YANG MEMBACA
25 / 26
```


### Слайд 26

**Что было не так:**

- `«Sebaik-baik kalian adalah yang belajar Al-Qur'an dan mengajarkannya.»` — This is the hadith every Indonesian Muslim can recite, and the deck's closing line — it must land word-for-word as they know it. The received Indonesian rendering is «Sebaik-baik kalian adalah orang yang mempelajari Al-Qur'an dan mengajarkannya.» Dropping 'orang' and using 'belajar' instead of 'mempelajari' makes the audience feel the near-miss even if they cannot name it. It also stands with no attribution to the Prophet at all — just a book reference — which is a lapse of adab on the deck's final slide.
- `«Sebaik-baik kalian adalah yang belajar
Al-Qur’an dan mengajarkannya.»
SAHIH AL-BUKHARI, 5027` — Three fixes on the closing slide. (1) Guillemets → Indonesian double quotes. (2) The standard Indonesian rendering includes «orang»: «Sebaik-baik kalian adalah orang yang mempelajari Al-Qur'an dan mengajarkannya» — without it the sentence is grammatically incomplete. (3) «SAHIH AL-BUKHARI, 5027» → «HR Bukhari, no. 5027», the Indonesian citation form (same fix needed on slides 8 and 22).

**Было:**

```
«Sebaik-baik kalian adalah yang belajar
Al-Qur’an dan mengajarkannya.»
SAHIH AL-BUKHARI, 5027
Umat yang Membaca · Galamat Tech · 2026
```

**Стало (в Figma):**

```
“Sebaik-baik kalian adalah orang yang
mempelajari Al-Qur’an dan mengajarkannya.”
Rasulullah ﷺ — HR Bukhari, no. 5027
Umat yang Membaca · Galamat Tech · 2026
```
