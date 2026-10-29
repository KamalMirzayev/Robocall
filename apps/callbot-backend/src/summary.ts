import { GoogleGenAI } from '@google/genai';
import { recordAiTokenUsage } from './ai-usage.js';

export type SummaryCategory = {
  id: number;
  title: string;
  phrases: string[];
};

export type SummaryMatch = {
  id: number;
  title: string;
  matchedPhrases: string[];
};

export const SUMMARY_CATEGORIES: SummaryCategory[] = [
  { id: 1, title: "Ailə üzvü ilə danışılıb", phrases: ["Mən atasıyam", "Mən anasıyam", "Mən həyat yoldaşıyam", "Mən qardaşıyam", "Mən bacısıyam", "O indi evdə yoxdur", "Mən onun yaxın qohumuyam", "Mən oğluyam", "Mən qızıyam", "Dayısı / əmisi mənəm", "Xalası / bibisi mənəm", "Hazırda yanında deyil", "Telefona mən cavab verirəm", "Öz nömrəsi deyil, ailə nömrəsidir", "Ailə üzvü kimi məlumat verirəm", "O işdədir, mən danışım", "Evdə olmadığı üçün cavab verdim", "Yaxını kimi məlumatı çatdıraram", "Mən həyat yoldaşı olaraq", "Qohumu kimi danışırıq"] },
  { id: 2, title: "Ailə üzvü ödənişdən imtina edir", phrases: ["Mən ödəməyəcəm", "Onun borcuna görə məsul deyiləm", "Borcu özü ödəsin", "Mən qarışmıram bu məsələyə", "Mənim imkanım yoxdur", "Ailə olaraq ödəyə bilmərik", "Mən cavabdeh deyiləm", "Mənlik deyil bu borc", "Öz problemi öz həll etsin", "Mən kömək edə bilmərəm", "Bu borca qarışmaq istəmirəm", "Ödəniş etməyəcəyik", "Mənim adıma kredit deyil", "Bu məsələ ilə maraqlanmıram", "Mənim büdcəm uyğun deyil", "O özü əlaqə saxlasın", "Mən pul verməyəcəm", "Bu borcu qəbul etmirik", "Bizlik məsələ deyil", "Mən heç nə ödəməyəcəm"] },
  { id: 3, title: "Ailə üzvü ödənişə meyillidir", phrases: ["Danışaram, ödəsin", "Məlumatı çatdıraram", "Kömək etməyə çalışarıq", "Ödəniş etməsi üçün deyərəm", "Ailə olaraq baxarıq", "Mümkün olsa ödəyərik", "Yaxın vaxtda həll edəcək", "Mən ona məlumat verərəm", "Qismən də olsa çalışarıq", "Ödəniş barədə danışacam", "Bu məsələni həll edirik", "Yardım edib kömək edərik", "Maaş alanda ödəyə bilər", "Mən dəstək olacam", "Yaxın günlərdə baxılacaq", "Gecikməni bağlamağa", "Ödəniş üçün plan qurarıq", "Məsələni diqqətdə saxlayırıq", "İmkan olan kimi ödəyəcək", "Əlaqə saxlayıb deyəcəm"] },
  { id: 4, title: "Alimenti var", phrases: ["Aliment ödəyirəm", "Aliment borcum var", "Uşağa aliment verirəm", "Maaşımdan aliment tutulur", "Alimentə görə çətinlik", "Aliment xərclərim çoxdur", "Hər ay aliment ödəyirəm", "Aliment ödənişim var", "Ailə xərclərim və aliment", "Aliment səbəbindən imkan", "Aliment çətin vəziyyətdə", "Aliment çıxıldıqdan sonra", "Aliment ödənişi etmişəm", "Uşaqlar üçün aliment verirəm", "Alimentə görə ödəyə bilmirəm", "Aliment borcunu bağlayıram", "Rəsmi aliment tutulur", "Aliment və kirayə ağır edir", "Aliment ödəniş gününü", "Alimentə görə hissəli"] },
  { id: 5, title: "Borc bağlanıb / tam ödənib", phrases: ["Borcu tam ödəmişəm", "Kredit bağlanıb", "Heç bir borcum qalmayıb", "Dünən ödəniş etmişəm", "Tam bağlamışam artıq", "Borcu sıfırlamışam", "Ödənişi etmişəm, yoxlayın", "Sistemə düşməyib hələ", "Hamısını ödəmişəm", "Borc qapanıb", "Son məbləği də yatırmışam", "Gecikmə qalmayıb artıq", "Kartdan ödəniş etmişəm", "Terminaldan ödəmişəm", "Mobil tətbiqlə ödəmişəm", "Bank vasitəsilə bağlamışam", "Qəbz məndə var", "Tam ödəniş olunub", "Borc bitib artıq", "Bağlanış ödənişini etmişəm"] },
  { id: 6, title: "Borclu tanınmır", phrases: ["Mən bu şəxsi tanımıram", "Səhv nömrəyə zəng etmisiniz", "Burada belə adam yoxdur", "Bu nömrə ona aid deyil", "Nömrəni yeni almışam", "Belə bir adam yaşamır burada", "Mən qohumu deyiləm", "Yanlış şəxsə zəng etmisiniz", "Bu adamı tanımıram", "Köhnə nömrə sahibidir", "Bu nömrə mənə məxsusdur", "Heç vaxt tanımamışam", "Burada işləmir artıq", "Ünvan səhvdir", "Mən sadəcə nömrə sahibiyəm", "Ailə üzvü deyiləm", "Başqa adam axtarırsınız", "Bu şəxslə əlaqəm yoxdur", "Mənə aid məsələ deyil", "Təkrar zəng etməyin"] },
  { id: 7, title: "Cavab vermir / əlaqə qurulmur", phrases: ["Telefona cavab vermir", "Zəng açılmır", "Nömrə məşğuldur", "Telefon sönülüdür", "Əlaqə saxlamaq mümkün olmadı", "Cavab yoxdur", "Dəfələrlə zəng edilib, açmır", "Nömrəyə çatmaq olmur", "Abunəçi cavab vermir", "Telefon əlçatan deyil", "Zəngə geri dönüş etmir", "Xətt daim məşğuldur", "Telefonu götürmür", "Əlaqə alınmadı", "Nömrə aktiv deyil", "Geri zəng etmir", "Danışmaq mümkün olmadı", "Zəng cavabsız qaldı", "Telefon bağlıdır", "Heç bir cavab alınmadı"] },
  { id: 8, title: "Əlaqə saxlanılacaq / geri dönüş edəcək", phrases: ["Sonra özü əlaqə saxlayacaq", "Geri zəng edəcək", "Uyğun vaxtda danışacaq", "Sonra danışarıq", "Bir azdan özü zəng edər", "İşdən çıxandan sonra", "Axşam danışacaq", "Sabah özü əlaqə saxlayacaq", "Məlumatı çatdıraram", "Geri dönüş olacaq", "Sonra sizinlə danışacaq", "Münasib vaxtda cavab verər", "Hazırda məşğuldur, sonra", "Görən kimi əlaqə saxlayacaq", "Sonra telefonuna baxacaq", "Yaxın vaxtda cavab verər", "İşlərini həll edib zəng edər", "Bir neçə saata danışacaq", "Sonra özü ödənişdən danışar", "Əlaqə üçün vaxt ayıracaq"] },
  { id: 9, title: "Güc strukturu iş yeri var", phrases: ["Daxili Qoşunlarda işləyirəm", "Müdafiə Nazirliyində çalışıram", "FHN əməkdaşıyam", "DTX-da işləyirəm", "DSX əməkdaşıyam", "Polis əməkdaşıyam", "Hərbi xidmətdəyəm", "Dövlət təhlükəsizlik orqanı", "Güc strukturunda çalışıram", "Xidmətdəyəm, danışa bilmirəm", "Növbədəyəm", "Hərbi hissədəyəm", "Postdayam", "Əməliyyatdayam", "Dövlət qurumunda işləyirəm", "Forma xidmətindəyəm", "Ezamiyyətdəyəm", "Xidmətdə olduğum üçün", "Dövlət xidmətində çalışıram", "Təhlükəsizlik orqanında"] },
  { id: 10, title: "Hissə-hissə ödəniş", phrases: ["Hissə-hissə ödəyərəm", "Hamısını birdən verə bilmiem", "Qismən ödəniş edə bilərəm", "Ay-ay ödəmək istəyirəm", "Bir hissəsini indi ödəyim", "Hər ay müəyyən məbləğ", "Hissəli bağlamaq istəyirəm", "Maaşıma uyğun ödəyərəm", "Tam məbləğ hazır deyil", "Bu ay yarısını verim", "Hər həftə ödəyə bilərəm", "Mərhələli ödəmək istəyirəm", "Hissəli plan mümkündür?", "Qalanını sonra ödəyərəm", "İlk ödənişi indi edim", "Büdcəmə uyğun ödəyərəm", "Kiçik məbləğlərlə bağlaram", "Tam ödəməyə imkan yoxdur", "Bir neçə dəfəyə ödəyim", "Hissə-hissə bağlamaq"] },
  { id: 11, title: "Hüquqi müdafiə / qərardan imtina edir", phrases: ["Məhkəməyə verin", "Hüquqşünasımla danışın", "Vəkilim baxır bu işə", "Qərarla razı deyiləm", "Borcu qəbul etmirəm", "Rəsmi etiraz etmişəm", "Hüquqi qaydada həll edəcəm", "Mən bu qərarı tanımıram", "Məhkəmə qərarı olmadan", "Hüquqi müdafiəyə müraciət", "İmtina edirəm bu borcdan", "Sənədləri göndərin baxım", "Rəsmi cavab gözləyirəm", "Şikayət etmişəm", "Hüquqi araşdırma gedir", "Qərar düzgün deyil", "Müqavilə ile razı deyiləm", "Vəkilim sizə cavab verəcək", "Hüquqi proses başlayıb", "Məhkəmə nəticəsindən sonra"] },
  { id: 12, title: "İcra dayandırılıb", phrases: ["İcra dayandırılıb", "İş icradan çıxıb", "İcra prosesi saxlanılıb", "Hazırda icra getmir", "İcra ilə bağlı qərar var", "İcra işi dayandırılıb", "Proses müvəqqəti dayanıb", "İcra üzrə gözləmə var", "Qərara əsasən dayandırılıb", "İcra tədbiri yoxdur hazırda", "Məhkəmə icranı saxlayıb", "İcra işi bağlanıb", "İcra üzrə yenilik gözlənilir", "Hazırda icra aktiv deyil", "Sənədlər icradan qaytarılıb", "İcra ilə bağlı araşdırma", "Dayandırılma qərarı çıxıb", "İcra üzrə məlumat gözləyirəm", "Hazırda hüquqi proses dayanıb", "İcra məsələsi dayandırılıb"] },
  { id: 13, title: "İş yeri tapılmır", phrases: ["Hazırda işsizəm", "İş yerim yoxdur", "İşdən çıxmışam", "İş tapa bilmirəm", "Hazırda heç yerdə işləmirəm", "Müvəqqəti işsiz qalmışam", "İşdən ixtisar olunmuşam", "Yeni iş axtarıram", "İş yerim bağlanıb", "Maaş gəlirim yoxdur", "İşsiz olduğum üçün", "İşdən ayrılmışam", "Hal-hazırda gəlirim yoxdur", "Mövsümi işləyirdim, iş bitib", "Müqaviləm bitib", "İş tapandan sonra ödəyərəm", "Gəlir mənbəyim yoxdur", "İşlə bağlı problem yaşayıram", "İş yerindən çıxarılmışam", "Yeni işə düzəlməyə çalışıram"] },
  { id: 14, title: "İş yerinə bildiriş göndərildi", phrases: ["İş yerimə məlumat göndərilib", "İş yerinə bildiriş gəlib", "Rəhbərlik məlumatlıdır", "Mühasibatlığa məlumat verilib", "İş yerimlə əlaqə saxlanılıb", "Şirkətə bildiriş göndərilib", "İş yerində bu barədə bilirlər", "Rəsmi bildiriş gəlib", "İş yerimdən mənə deyiblər", "HR şöbəsinə məlumat çatıb", "Müəssisəyə məktub göndərilib", "İş yerimdən xəbərdaram", "Rəhbərliyə məlumat verilib", "İş yerinə xəbərdarlıq gəlib", "Mühasib mənə məlumat verdi", "Şirkət bu məsələni bilir", "İş yerində mənimlə danışılıb", "Bildiriş iş yerimə çatıb", "Rəsmi məktub göndərilib", "İş yerinə məlumat çatıb"] },
  { id: 15, title: "Maaş / pensiya gözləyir", phrases: ["Maaş alan kimi ödəyərəm", "Pensiya gününü gözləyirəm", "Maaş hələ yatmayıb", "Pensiya kartıma düşəndə", "Maaş gecikir", "Ayın sonunda maaş alacam", "Pensiya gələn həftə olacaq", "Maaşımı gözləyirəm", "Pensiya ilə bağlayacam", "Dövlət ödənişi gələndə", "Maaş kartıma pul oturanda", "Pensiya günüm yaxınlaşır", "Maaşdan sonra baxacam", "Pensiya gələn kimi ödəyərəm", "Maaşım köçürülməyib hələ", "Pensiya gecikib", "Maaşımı hissə-hissə alıram", "Pensiya ilə qismən ödəyərəm", "Maaş günü yaxınlaşır", "Gəlir daxil olanda ödəyərəm"] },
  { id: 16, title: "Maraq göstərmir / zəngi qəbul etmir", phrases: ["Danışmaq istəmir", "Maraqlanmır", "Zəngi üzümə bağladı", "Telefona cavab vermir", "Dinləmədən söndürdü", "Ünsiyyətdən yayınır", "Məlumat almaq istəmədi", "Danışığa davam etmədi", "Zəngə reaksiya vermədi", "Söhbəti yarımçıq saxladı", "Əlaqədən qaçır", "Təkrar zəngləri qəbul etmir", "Maraq göstərmədi", "Danışmağa vaxt ayırmadı", "Zəng açılıb dərhal bağlandı", "Sual vermədən danışığı bitirdi", "Heç bir münasibət bildirmədi", "Əlaqə saxlamaq istəmir", "Cavab verməkdən imtina etdi", "Zəngləri qəbul etmir"] },
  { id: 17, title: "Məhkəməyə müraciət etməyi tələb edir", phrases: ["Məhkəməyə verin", "Rəsmi qaydada həll edin", "Məhkəmə qərarı olsun", "Hüquqi proses başlasın", "İstəyirsiniz məhkəməyə müraciət edin", "Vəkilimlə danışacam", "Məhkəmədə həll edərik", "Rəsmi sənəd göndərin", "Hüquqi tədbir görün", "Qərarı məhkəmə versin", "Mən razı deyiləm, məhkəməyə gedin", "Hüquqi yolla davam edin", "Məhkəməyə çıxarmağınızı istəyirəm", "Bu məsələni məhkəmə həll etsin", "Rəsmi bildiriş göndərin", "Hüquqi şöbə ilə danışacam", "Qanuni qaydada həll olunsun", "Məhkəmə çağırışı gəlsin", "Hüquqi prosedur tətbiq edin", "Məhkəmə qərarından sonra baxaram"] },
  { id: 18, title: "Müştəri həbsdədir", phrases: ["Həbsdədir", "Cəza çəkir", "Hazırda həbsxanadadır", "Tutulub", "Azadlıqdan məhrum olunub", "Penitensiar müəssisədədir", "İçəridədir", "Həbs olunduğu üçün ödəyə bilmir", "Hazırda istintaqdadır", "Saxlanılıb", "Məhkəmə qərarı ilə həbs olunub", "Həbsdə olduğu üçün əlaqə yoxdur", "Təcridxanadadır", "Cəzaçəkmə müəssisəsindədir", "Hazırda polis nəzarətindədir", "Həbs müddəti davam edir", "Əlaqə saxlamaq mümkün deyil, həbsdədir", "Həbsdən çıxandan sonra baxacaq", "Məhkum olunub", "Hazırda azadlıqda deyil"] },
  { id: 19, title: "Müştəri vəfat edib", phrases: ["Rəhmətə gedib", "Vəfat edib", "Dünyasını dəyişib", "Artıq həyatda deyil", "Ölüb", "Keçinib", "Bir müddət əvvəl vəfat edib", "Allah rəhmət eləsin, rəhmətə gedib", "Dünyasını dəyişdiyi üçün əlaqə yoxdur", "Mərhum olub", "Yas mərasimləri var", "Ölüm xəbəri doğrudur", "Başınız sağ olsun, vəfat edib", "Ailə üzvləri məlumat verdi ki, ölüb", "Vəfat etdiyi üçün ödəmə edə bilmir", "Həyatda olmadığı üçün danışmaq mümkün deyil", "Bir neçə ay əvvəl vəfat edib", "Dəfn mərasimi olub", "Ölüm haqqında sənəd var", "Artıq yaşamır"] },
  { id: 20, title: "Ödənişdən imtina edir", phrases: ["Ödəməyəcəm", "Borcu bağlamayacam", "Mənlik deyil", "İmkanım yoxdur, ödəmərəm", "Heç nə ödəmək istəmirəm", "Bu borcu qəbul etmirəm", "Qətiyyən ödəniş etməyəcəm", "Nə istəyirsiniz edin", "Məhkəməyə verin", "Pul verməyəcəm", "Mən bu borcu saymıram", "Ödəniş fikrim yoxdur", "Heç bir məbləğ ödəmərəm", "İmtina edirəm", "Danışmağa ehtiyac yoxdur", "Mənə zəng etməyin", "Bu məsələ ilə maraqlanmıram", "Borcu ödəmək niyyətim yoxdur", "İstəyirsiniz hüquqi tədbir görün", "Nə indi, nə sonra ödəyəcəm"] },
  { id: 21, title: "Ödənişə söz verib", phrases: ["Sabah ödəyəcəm", "Bu həftə bağlayacam", "Maaş alan kimi ödəyərəm", "Yaxın günlərdə ödəmə edəcəm", "Gecikməni bağlayacam", "Ayın sonu ödəyərəm", "Ödəniş edəcəyimə söz verirəm", "Bu ay həll edəcəm", "Kartıma pul düşən kimi ödəyərəm", "Qismən də olsa ödəyəcəm", "Gələn həftə ödəniş olacaq", "Ödəməyə çalışacam", "Borcu bağlamağı planlayıram", "Pul tapıb ödəyərəm", "Gecikməni aradan qaldıracam", "Bir neçə gün vaxt verin, ödəyim", "Tam məbləği ödəyəcəm", "Hissə-hissə bağlayacam", "Ödənişi gecikdirməyəcəm", "Yaxın zamanda ödəniş olacaq"] },
  { id: 22, title: "Ödənişi təxirə saldı / tarix göstərdi", phrases: ["Ayın 5-i ödəyəcəm", "Sabah ödəniş edərəm", "Gələn həftə bağlayacam", "Maaş günü ödəyərəm", "Ayın sonunda ödəyəcəm", "2 günə ödəniş olacaq", "Cümə günü ödəyərəm", "Pensiya alan kimi ödəyərəm", "Tarix verin, həmin gün ödəyim", "Bu ayın 15-i bağlayaram", "Bir az vaxt verin", "Gələn ay ödəyəcəm", "Həftəsonu ödəniş edərəm", "Kartıma pul düşəndə ödəyərəm", "Ayın ortasında ödəyərəm", "Maaş gecikir, sonra ödəyərəm", "Sabahdan sonra bağlayaram", "Təxirə salın, ödəyəcəm", "Müəyyən tarixdə ödəmə olacaq", "Vaxt istəyirəm, sonra ödəyim"] },
  { id: 23, title: "Təqaüd alır / təsdiq elədi", phrases: ["Təqaüd alıram", "Təqaüdüm var", "Tələbə təqaüdü alıram", "Təqaüd günü ödəyərəm", "Təqaüd kartıma düşəndə ödəyərəm", "Təqaüd aldığımı təsdiq edirəm", "Dövlət təqaüdü alıram", "Elmi təqaüd alıram", "Təqaüdlə ödəyəcəm", "Təqaüd gələn kimi bağlayaram", "Hər ay təqaüd alıram", "Təqaüdüm ayın əvvəlində olur", "Təqaüd hesabıma yatır", "Təqaüd gecikir", "Təqaüddən sonra ödəniş edərəm", "Təqaüdümü gözləyirəm", "Təqaüdlə qismən ödəyərəm", "Təqaüdüm təsdiqlənib", "Təqaüd gəliri ilə ödəyirəm", "Təqaüd alan şəxsəm"] },
  { id: 24, title: "Ünvana bildiriş göndərildi", phrases: ["Ev ünvanıma bildiriş gəlib", "Ünvana məktub göndərilib", "Rəsmi bildiriş almışam", "Evə xəbərdarlıq gəlib", "Poçt vasitəsilə məktub gəlib", "Ünvanıma sənəd göndərilib", "Bildiriş artıq çatıb", "Məktubu almışam", "Evdə bildiriş qoyublar", "Yaşadığım ünvana göndərilib", "Rəsmi məktub ünvanıma çatıb", "Bildirişlə tanış olmuşam", "Poçtdan məlumat gəlib", "Ünvan üzrə xəbərdarlıq edilib", "Məktub ailə üzvünə təqdim olunub", "Bildiriş kağızı gəlib", "Ünvan məlumatıma göndərilib", "Evə rəsmi xəbər gəlib", "Poçtalyon məktub gətirib", "Ünvana məlumat çatdırılıb"] },
  { id: 25, title: "Ünvana vizit", phrases: ["Evə gəliblər", "Ünvana baxış olub", "Yaşadığım ünvana gəlinib", "Vizit edilib", "Evdə mənimlə danışılıb", "Ünvan üzrə yoxlama olub", "Gəlib məlumat veriblər", "Evə yaxınlaşıblar", "Ünvanda görüş olub", "Yaşadığım yerə gəliblər", "Evə bildiriş üçün gəlinib", "Ünvan üzrə əlaqə saxlanılıb", "Məni ünvanda tapıblar", "Evdə ailə üzvü ilə danışılıb", "Vizit zamanı məlumat verilib", "Ünvan üzrə xəbərdarlıq olunub", "Evdə olmadığım üçün ailəmlə danışılıb", "Yaşayış yerimə baxış keçirilib", "Ünvan üzrə məlumat təqdim olunub", "Vizit qeydi aparılıb"] },
  { id: 26, title: "Yenidən zəng etməyi xahiş etdi", phrases: ["Sonra zəng edin", "Bir azdan əlaqə saxlayın", "Axşam zəng edin", "Sabah danışaq", "İşdən çıxım, sonra zəng edin", "Münasib vaxtda əlaqə saxlayın", "Hazırda məşğulam, sonra zəng edin", "Daha sonra danışaram", "Günorta zəng edin", "Bir neçə saata zəng edin", "İclasdayam, sonra danışaq", "Yoldaşım yanımdadır, sonra zəng edin", "İş vaxtı deyil, sonra zəng edin", "Hazırda danışa bilmirəm", "Sonra özüm geri dönüş edərəm", "Sabah səhər zəng edin", "Uyğun vaxtda danışarıq", "Sonra ətraflı danışaq", "Hazırda vaxtım yoxdur", "Təkrar əlaqə saxlayın"] },
  { id: 27, title: "Xaricdədir", phrases: ["Xaricdəyəm", "Ölkə xaricindəyəm", "Rusiyadayam", "Türkiyədəyəm", "Avropadayam", "Xaricdə işləyirəm", "Azərbaycanda deyiləm", "Səfərdəyəm", "Xaricdən gələndə ödəyərəm", "Hazırda ölkədə deyiləm", "Xaricdə olduğum üçün ödəyə bilmirəm", "Xaricdə işlə bağlıyam", "Qayıdandan sonra baxaram", "Xarici nömrə istifadə edirəm", "Xaricdə olduğum üçün kart yanımda deyil", "Pul köçürəndə ödəyərəm", "Xaricdə qazanc gözləyirəm", "Geri qayıdanda bağlayaram", "Xaricdə yaşayıram", "Xaricdən əlaqə saxlayaram"] },
  { id: 28, title: "Xəstədir", phrases: ["Xəstəyəm", "Halım yaxşı deyil", "Xəstəxanadayam", "Müalicə alıram", "Səhhətimlə bağlı problem var", "Hazırda xəstəyəm", "Həkim nəzarətindəyəm", "Dərman xərclərim çoxdur", "Əməliyyat olunmuşam", "Sağlamlıq problemim var", "Müalicəyə pul xərcləmişəm", "Hazırda danışa bilmirəm, xəstəyəm", "Ev şəraitində müalicə alıram", "Xəstəliyə görə işləyə bilmirəm", "Səhhətim düzələndən sonra ödəyərəm", "Klinikadayam", "Tibbi problemlərim var", "Müayinədəyəm", "Xəstə olduğum üçün gecikirəm", "Sağlamlığımla bağlı çətinlik yaşayıram"] },
  { id: 29, title: "Əməliyyat olunub", phrases: ["Əməliyyat olunmuşam", "Cərrahiyyə əməliyyatı keçirmişəm", "Xəstəxanada əməliyyat oldum", "Hazırda əməliyyatdan çıxmışam", "Müalicə dövründəyəm", "Əməliyyata görə işləyə bilmirəm", "Sağlamlığımla bağlı əməliyyat keçirmişəm", "Əməliyyat xərclərim çox olub", "Reabilitasiya dövründəyəm", "Həkim nəzarətindəyəm", "Yeni əməliyyat olunmuşam", "Hazırda səhhətim imkan vermir", "Əməliyyat səbəbindən gecikmə yaranıb", "Müalicəyə çox xərc çıxıb", "Ayağa qalxandan sonra ödəyərəm", "Klinikadayam", "Tibbi prosedur keçirmişəm", "Əməliyyatdan sonra evdəyəm", "Səhhətim düzələndən sonra baxaram", "Əməliyyat səbəbindən maddi çətinlik yaşayıram"] },
  { id: 30, title: "Qəbz təqdim edəcək", phrases: ["Qəbzi göndərəcəm", "Ödəniş qəbzi məndədir", "Çeki təqdim edərəm", "Qəbzi paylaşacam", "Ödəniş sənədini göndərəcəm", "Qəbzi yoxlayın", "Çeki saxlamışam", "Qəbzi təqdim edə bilərəm", "Ödəniş sübutu var", "Bank qəbzi məndədir", "Ekran görüntüsü göndərəcəm", "Qəbzi WhatsApp-la ataram", "Terminal qəbzi var", "Mobil tətbiq qəbzi var", "Köçürmə qəbzini təqdim edərəm", "Ödəniş təsdiqini göndərəcəm", "Çeki tapıb göndərəcəm", "Qəbzi sistemə təqdim edərəm", "Ödəniş etdiyimi sübut edərəm", "Qəbzlə təsdiqləyəcəm"] },
  { id: 31, title: "Krediti xəbəri olmadığını deyir", phrases: ["Mənim belə kreditim yoxdur", "Kredit götürməmişəm", "Bu kreditdən xəbərim yoxdur", "Mən müraciət etməmişəm", "İlk dəfə eşidirəm", "Belə borcum olduğunu bilmirəm", "Mənə aid deyil", "Mən heç nə imzalamamışam", "Kredit barədə məlumatım yoxdur", "Bu məsələni tanımıram", "Mənim adıma necə kredit ola bilər?", "Belə ödəniş etməmişəm", "Mən bu krediti qəbul etmirəm", "Mənə xəbər verilməyib", "Bu kredit səhvdir", "Mən belə müqavilə bağlamamışam", "Adımdan istifadə olunub ola bilər", "Kredit məlumatı mənə çatmayıb", "Mən bu borcu tanımıram", "Araşdırılmasını istəyirəm"] },
  { id: 32, title: "Ailə üzvünü itirib", phrases: ["Yaxınımı itirmişəm", "Ailə üzvüm vəfat edib", "Yasımız var", "Başımız qarışıqdı, yasdayıq", "Rəhmətə gedənimiz olub", "Evdə yas mərasimi var", "Ailəvi itki yaşamışıq", "Psixoloji olaraq çətin durumdayam", "Yas səbəbindən məşğulam", "Dəfn mərasimi ilə məşğuluq", "Ailə üzvümü yeni itirmişəm", "Başımız yas işlərinə qarışıb", "Hazırda ailə problemi yaşayırıq", "Yasdan sonra baxaram", "Maddi çətinlik yaranıb", "Ailəvi ağır durumdayıq", "Həyat yoldaşımı itirmişəm", "Valideynimi itirmişəm", "Qardaşımı / bacımı itirmişəm", "Bu səbəbdən ödəniş gecikir"] },
  { id: 33, title: "Hərbi xidmətdədir", phrases: ["Hərbi xidmətdəyəm", "Əsgərlikdəyəm", "Xidmətdə olduğum üçün danışa bilmirəm", "Hərbi hissədəyəm", "Postdayam", "Növbədəyəm", "Təlimdəyəm", "Əlaqə məhduddur", "Telefona çıxışım yoxdur", "Hərbi bölgədəyəm", "Xidmətdən sonra danışaram", "Əsgərəm", "Komandirlikdəyəm", "Hərbi səbəbdən məşğulam", "Ezamiyyətdəyəm", "Hərbi xidmətə görə gecikirəm", "Maaş gələndə ödəyərəm", "Hərbi xidmətdə olduğum üçün imkan yoxdur", "Hissədə xidmət keçirəm", "Xidmətdən qayıdandan sonra baxaram"] },
  { id: 34, title: "Müəllimdir", phrases: ["Müəllim işləyirəm", "Məktəbdə çalışıram", "Təhsil sahəsində işləyirəm", "Dərsdəyəm", "Hazırda dərs keçirəm", "Məktəbdəyəm", "Şagirdlərlə məşğulam", "Dərs vaxtıdır", "Müəllim maaşı alıram", "Təhsil işçisiyəm", "Kursda dərs deyirəm", "Universitetdə çalışıram", "Dərsdən sonra danışaram", "İmtahanlarla məşğulam", "Tədris prosesindəyəm", "Maaş günü ödəyərəm", "Təhsil müəssisəsində işləyirəm", "Müəllim olduğum üçün məşğulam", "Məktəb işləri çoxdur", "Təhsil sahəsində çalışdığım üçün vaxtım yoxdur"] },
  { id: 35, title: "Faiz silinməsini istəyir", phrases: ["Faizi silin", "Faizləri bağışlayın", "Yalnız əsas borcu ödəyim", "Cəriməni silin", "Faiz çox yığılıb", "Gecikmə faizini çıxın", "Endirim edin", "Faizsiz bağlamaq istəyirəm", "Borcu güzəştlə bağlayım", "Faizlər çoxdur, ödəyə bilmirəm", "Əsas məbləği ödəyərəm", "Cərimə hissəsini silin", "Faizə güzəşt edin", "Borcu endirimlə bağlamaq istəyirəm", "Faizlər dayansın", "Gecikmə haqqını silin", "Kampaniya varsa tətbiq edin", "Faizləri azaltmaq mümkündür?", "Tam məbləğə imkan yoxdur, güzəşt istəyirəm", "Borca endirim tətbiq edin"] },
  { id: 36, title: "Hüquqi mərhələyə yönləndirildi", phrases: ["Hüquqi şöbəyə yönləndirilib", "Hüquqi proses başlayıb", "Məhkəmə öncəsi mərhələdədir", "İş hüquqi bölməyə keçib", "Hüquqi tədbir görüləcək", "Rəsmi prosedur başlayıb", "Hüquqi araşdırmaya verilib", "Məhkəmə prosesi gözlənilir", "Sənədlər hüquq şöbəsindədir", "Hüquqi icraata yönləndirilib", "Rəsmi xəbərdarlıq edilib", "Hüquqi mərhələdə baxılır", "İcra tədbirləri başlanacaq", "Məhkəmə üçün hazırlanır", "Hüquqşünaslar baxır məsələyə", "Rəsmi hüquqi tədbirlər görülür", "İş hüquqi status alıb", "Məhkəməyə təqdim olunacaq", "Hüquqi qərar gözlənilir", "Borc hüquqi mərhələyə keçib"] },
  { id: 37, title: "Ödəniş linki istəyir", phrases: ["Ödəniş linkini göndərin", "Link atın ödəyim", "Onlayn ödəniş etmək istəyirəm", "Ödəniş üçün keçid göndərin", "Linklə ödəyəcəm", "Kartla ödəniş etmək istəyirəm", "SMS ilə link göndərin", "WhatsApp-a link atın", "Ödəniş səhifəsini göndərin", "Haradan ödəyim?", "Online ödəniş mümkündür?", "Ödəniş keçidi istəyirəm", "Mobil ödəniş linki göndərin", "Link vasitəsilə bağlayaram", "Ödəniş ünvanını göndərin", "İnternetdən ödəyim", "Sayt linkini atın", "Kart məlumatı daxil edib ödəyim", "Elektron ödəniş etmək istəyirəm", "Birbaşa ödəniş linki göndərin"] },
  { id: 38, title: "Baş ofisə yaxınlaşacağını bildirir", phrases: ["Baş ofisə gələcəm", "Filiala yaxınlaşacam", "Ofisə gedib ödəyərəm", "Şəxsən yaxınlaşmaq istəyirəm", "Sabah ofisə gələcəm", "Yaxın günlərdə yaxınlaşaram", "Baş ofisdə danışarıq", "Yerində həll etmək istəyirəm", "Ofisə gəlib bağlayacam", "Filialda ödəniş edərəm", "Mərkəzi ofisə yaxınlaşaram", "Şəxsən məlumat almaq istəyirəm", "Gedib qəbz təqdim edərəm", "Ofisdə danışmaq istəyirəm", "Yaxınlaşıb məsələni həll edərəm", "Baş ofisə nə vaxt gəlim?", "Filial ünvanını göndərin", "Yerində baxarıq", "Şirkətə yaxınlaşacam", "Ofisə gələndə ödəyərəm"] },
  { id: 39, title: "Nömrə deaktivdir", phrases: ["Bu nömrə aktiv deyil", "Nömrə bağlanıb", "Xətt deaktiv olunub", "Nömrədən istifadə etmirəm", "Köhnə nömrəmdir", "Bu nömrə işləmir", "Sim kart bağlanıb", "Əlaqə nömrəm dəyişib", "Nömrə ləğv olunub", "Xətt istifadədə deyil", "Telefon nömrəsi deaktivdir", "Bu nömrə artıq məndə deyil", "Nömrə söndürülüb", "Aktiv xəttim yoxdur", "Köhnə əlaqə nömrəsidir", "Nömrəyə girişim yoxdur", "Bu xətt bağlatdırılıb", "Yeni nömrə istifadə edirəm", "Nömrə artıq fəaliyyət göstərmir", "Əlaqə üçün başqa nömrə istifadə olunur"] },
  { id: 40, title: "Gündəlik qazanc ilə işləyir", phrases: ["Gündəlik işləyirəm", "Günəmuzd işləyirəm", "Gündəlik qazancım olur", "Hər gün iş olsa pul qazanıram", "Stabil maaşım yoxdur", "Günlük qazandığımla dolanıram", "İş çıxsa işləyirəm", "Günlük gəlirlə yaşayırıq", "Bu gün qazanc olmayıb", "Günəmuzd fəhləyəm", "Tikintidə günlük işləyirəm", "Taksi sürüb günlük qazanıram", "Bazarda işləyirəm", "Gündəlik gəlir dəyişir", "İş olmayanda qazanc olmur", "Gündəlik qazanca görə ödəyərəm", "Günlük pul gələndə ödəyərəm", "Mövsümi günlük işlər görürəm", "Daimi işim yoxdur", "Günlük qazandığım qədər ödəyə bilərəm"] },
  { id: 41, title: "Əlavə gəlir / satış və ödəniş gözləyir", phrases: ["Bonus alacam", "Avans gözləyirəm", "Sığorta pulu gələcək", "Kompensasiya gözləyirəm", "Satışdan pul gələcək", "Ev satıram", "Maşını satıb ödəyərəm", "Torpaq satışındandır ümidim", "Obyekti icarəyə vermişəm", "Kirayə gəlirim var", "Əlavə gəlir gözləyirəm", "Pul daxil olanda ödəyərəm", "Alacağım var, gələndə ödəyərəm", "Satış tamamlanandan sonra bağlayaram", "Ev alqı-satqısı gözlənilir", "Maşın satışı ilə bağlı müştəri gözləyirəm", "Kirayə pulu ayın sonu gələcək", "Obyektdən gəlir olacaq", "Sığorta ödənişi təsdiqlənib", "Avans yatandan sonra ödəyərəm"] },
  { id: 42, title: "İş və biznes səbəbilə ödənişi gecikdirir", phrases: ["Yeni işə başlamışam", "Mövsümi işləyirəm", "Taksi sürürəm", "Tikintidə işləyirəm", "Fermerliklə məşğulam", "Əkin mövsümünü gözləyirəm", "Mal-qara satacam", "Obyektim bağlanıb", "Biznesim zəifləyib", "Satışlar zəif gedir", "Gəlir əvvəlki kimi deyil", "İşlər düzələndə ödəyərəm", "Mövsüm açılandan sonra ödəyərəm", "Hazırda qazanc zəifdir", "Müştəri azdır", "Ticarət zəifləyib", "Tikintidə iş azalıb", "Taksidə qazanc düşüb", "Məhsul satandan sonra ödəyərəm", "İşlər yaxşılaşanda borcu bağlayaram"] },
  { id: 43, title: "Dövlət və xüsusi xidmət sahəsində çalışır", phrases: ["Müqaviləli hərbçiyəm", "Dövlət işçisiyəm", "Müəllim işləyirəm", "Həkiməm", "Sürücü işləyirəm", "DTX-da çalışıram", "FHN əməkdaşıyam", "DSX-da işləyirəm", "Dövlət qurumunda işləyirəm", "Xidmətdə olduğum üçün məşğulam", "Növbədəyəm", "Maaş günü ödəyərəm", "Dövlət maaşı alıram", "Rəsmi iş yerim var", "Ezamiyyətdəyəm", "İş vaxtında danışa bilmirəm", "Xidmətdən sonra əlaqə saxlayaram", "Dövlət xidmətində çalışdığım üçün vaxtım yoxdur", "İş yerimlə bağlı məhdudiyyət var", "Maaş daxil olanda ödəniş edərəm"] },
];

const AZ_CHAR_MAP: Record<string, string> = {
  "ə": "e",
  "ı": "i",
  "ö": "o",
  "ü": "u",
  "ğ": "g",
  "ş": "s",
  "ç": "c",
};

const STOP_WORDS = new Set([
  "men", "sen", "siz", "biz", "o", "bu", "ve", "ile", "kimi", "ucun", "ki", "da", "de",
  "bir", "hec", "artiq", "hazirda", "sonra", "oldugu", "olan", "kimi", "var", "yoxdur",
]);

const FAMILY_RELATION_RE = /\b(men\s+)?(atasiyam|anasiyam|qardasiyam|bacisiyam|ogluyam|qiziyam|qohumuyam|yoldasiyam|dayisiyam|emisiyam|xalasiyam|bibisiyam|heyat yoldasiyam)\b|\b(onun|borclunun|musterinin)\s+(atasi|anasi|qardasi|bacisi|oglu|qizi|qohumu|yoldasi|dayisi|emisi|xalasi|bibisi|heyat yoldasi)\b/;
const PAYMENT_RE = /\b(ode|odem|odenis|odeyecem|odeyecem|odeyerem|oduyecem|eleyecem|eleyeceyem|bagla|baglayacam|baglayaram|hell edecem|hell ederem|yatr|yatir|verecem|vererem)\b/;
const FUTURE_DATE_RE = /\b(sabah|gelen hefte|gelen ay|heftesonu|ayin|gun|gune|cum[eə]|iki gun|bir iki gun|yaxin gun|vaxt|sonra|maas gunu|pensiya alan kimi|kartima pul dusende)\b/;
const postCallSummaryAiEnabled = process.env.POST_CALL_SUMMARY_AI_ENABLED !== "false";
const postCallSummaryModel = process.env.POST_CALL_SUMMARY_MODEL || "gemini-2.5-flash";
const postCallSummaryTimeoutMs = Number(process.env.POST_CALL_SUMMARY_TIMEOUT_MS || 25000);
const postCallSummaryMaxTranscriptChars = Number(process.env.POST_CALL_SUMMARY_MAX_TRANSCRIPT_CHARS || 12000);

function hasAny(normalizedText: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(normalizedText));
}

function normalizeForSummary(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[əıöüğşç]/g, (char) => AZ_CHAR_MAP[char] || char)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function customerTranscriptOnly(transcript: string) {
  const lines = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const customerLines = lines
    .filter((line) => /^C\s*:/i.test(line))
    .map((line) => line.replace(/^C\s*:\s*/i, ""));
  return customerLines.length > 0 ? customerLines.join("\n") : transcript;
}

function significantTokens(value: string) {
  return normalizeForSummary(value)
    .split(" ")
    .filter((token) => (token.length > 2 || token === "is") && !STOP_WORDS.has(token));
}

function phraseMatches(normalizedText: string, textTokenSet: Set<string>, phrase: string) {
  const normalizedPhrase = normalizeForSummary(phrase);
  if (!normalizedPhrase) return false;
  if (normalizedText.includes(normalizedPhrase)) return true;

  const tokens = significantTokens(phrase);
  if (tokens.length >= 2) return tokens.every((token) => textTokenSet.has(token));
  if (tokens.length === 1 && tokens[0].length >= 6) return textTokenSet.has(tokens[0]);
  return false;
}

function logicalCategoryMatches(categoryId: number, normalizedText: string) {
  switch (categoryId) {
    case 1:
      return FAMILY_RELATION_RE.test(normalizedText)
        || /\b(timur deyil|borclu deyil|oz nomresi deyil|aile nomresidir|evde yoxdur|yaninda deyil)\b/.test(normalizedText);
    case 2:
      return FAMILY_RELATION_RE.test(normalizedText)
        && hasAny(normalizedText, [/\b(mesul deyil|cavabdeh deyil|qarismiram|bizlik deyil|menlik deyil|pul vermeyecem|odemeyeceyik|komek ede bilmerem)\b/]);
    case 3:
      return FAMILY_RELATION_RE.test(normalizedText)
        && hasAny(normalizedText, [/\b(melumat(i)? catdir|deyerem|danisaram|komek|destek|hell edirik|diqqetde saxlayiriq|imkan olan kimi)\b/]);
    case 4:
      return /\baliment\b/.test(normalizedText);
    case 5:
      return hasAny(normalizedText, [/\b(borc|kredit|gecikme)\b.*\b(baglanib|qapanib|bitib|sifirlanib|qalmayib|tam odenib)\b/, /\b(qebz mende|terminaldan odemishem|kartdan odemishem|bank vasitesile|mobil tetbiqle)\b/]);
    case 6:
      return hasAny(normalizedText, [/\b(tanimiram|seh[vf] nomre|yanlis sexs|bu nomre ona aid deyil|nomreni yeni almisam|basqa adam|tekrar zeng etmeyin|mene aid mesele deyil)\b/]);
    case 7:
      return hasAny(normalizedText, [/\b(cavab vermir|zeng acilmir|telefon bagli|telefon sonuludur|telefonu goturmur|nomre mesguldur|nomre aktiv deyil|geri zeng etmir|elaqe alinmadi|elaqe saxlamaq mumkun olmadi|danismaq mumkun olmadi|zeng cavabsiz|hec bir cavab)\b/, /\btapa bilmirem\b/]);
    case 8:
      return hasAny(normalizedText, [/\b(ozu elaqe saxlayacaq|geri zeng edecek|geri donus olacaq|melumati catdiraram|sonra sizinle danisacaq|yaxin vaxtda cavab verer|goren kimi elaqe saxlayacaq|elaqe ucun vaxt ayiracaq)\b/]);
    case 9:
      return hasAny(normalizedText, [/\b(daxili qosun|mudafie nazirliyi|fhn|dtx|dsx|polis|herbi|dovlet tehlukesizlik|guc struktur|xidmetdeyem|novbedeyem|postdayam|emeliyyatdayam|forma xidmeti|ezamiyyetdeyem)\b/]);
    case 10:
      return hasAny(normalizedText, [/\b(hisse hisse|hisseli|qismen|qalanini|hamisini yox|ay ay|merheleli|bir nece defeye|yarisi|tam mebleg hazir deyil|kicik mebleglerle)\b/]);
    case 11:
      return hasAny(normalizedText, [/\b(huquq|huquqsunas|vekil|qerarla razi deyil|borcu qebul etmir|resmi etiraz|mehkeme qerari olmadan|sikayet etmisem|muqavile ile razi deyil)\b/]);
    case 12:
      return /\bicra\b/.test(normalizedText) && hasAny(normalizedText, [/\b(dayandirilib|saxlanilib|getmir|qerar var|gozleme var|aktiv deyil|qaytarilib|baglanib|dayanib)\b/]);
    case 13:
      return hasAny(normalizedText, [/\bissiz\b/, /\bis yerim yoxdur\b/, /\bisden cix/, /\bis tapa bilmir/, /\bhec yerde islemirem\b/, /\bisden ixtisar\b/, /\byeni is axtar/, /\bis yerim baglanib\b/, /\bgelir menbeyim yoxdur\b/, /\bmuqavilem bitib\b/, /\bisle bagli problem\b/, /\bis yerinden cixarilmisam\b/]);
    case 14:
      return /\bis\b/.test(normalizedText) && hasAny(normalizedText, [/\b(bildiris|melumat gonderilib|rehberlik|muhasibat|sirket|hr|muessise|resmi mektub|xeberdarliq|muhasib)\b/]);
    case 15:
      return hasAny(normalizedText, [/\bmaas\b/, /\bpensiya\b/, /\bgelir daxil olanda\b/, /\bkartima pul oturanda\b/, /\bkartima pul dusende\b/]);
    case 16:
      return hasAny(normalizedText, [/\b(danismaq istemir|maraqlanmir|zengi uzume bagladi|dinlemeden sondurdu|unsiyyetden yayin|melumat almaq istemedi|danisiga davam etmedi|zeng[eə] reaksiya vermedi|sohbeti yarimciq saxladı|elaqeden qacir|tekrar zengleri qebul etmir|maraq gostermedi|danismaga vaxt ayirmadi|zengleri qebul etmir)\b/]);
    case 17:
      return hasAny(normalizedText, [/\b(mehkemeye ver|mehkemede hell|mehkemeye gedin|mehkemeye cixarma|mehkemeye muraciet|mehkeme qerari|mehkeme cagiris|resmi qaydada|resmi sened|resmi bildiris|huquqi tedbir|huquqi prosedur|qanuni qaydada)\b/]);
    case 18:
      return hasAny(normalizedText, [/\b(hebsdedir|hebsxana|ceza cekir|tutulub|azadliqdan mehrum|penitensiar|iceridedir|istintaqdadir|saxlanilib|tecridxana|cezacekme|polis nezaretinde|hebs muddeti|mehkum|azadliqda deyil)\b/]);
    case 19:
      return hasAny(normalizedText, [/\b(rehmete gedib|vefat edib|dunyasini deyisib|heyatda deyil|olub|olum|kecinib|merhum|yas merasimi|basiniz sag olsun|defn|artiq yasamir)\b/]);
    case 20:
      return hasAny(normalizedText, [/\b(odemeyecem|baglamayacam|odemerem|hec ne odemek istemirem|qetiyyen odenis etmeyecem|pul vermeyecem|odenis fikrim yoxdur|imtina edirem|mene zeng etmeyin|borcu odemek niyyetim yoxdur|ne indi ne sonra)\b/]);
    case 21:
      return PAYMENT_RE.test(normalizedText)
        && hasAny(normalizedText, [/\b(soz verirem|calisacam|planlayiram|gecikmeni|borcu|odenis|tam meblegi|yaxin zamanda|bu ay|sabah|hefte|maas alan kimi|pul tapib)\b/]);
    case 22:
      return PAYMENT_RE.test(normalizedText) && FUTURE_DATE_RE.test(normalizedText);
    case 23:
      return /\b(teqaud|telebe teqaudu|dovlet teqaudu|elmi teqaud)\b/.test(normalizedText);
    case 24:
      return hasAny(normalizedText, [/\b(unvan|ev|poct|mek[t]?ub|bildiris|xeberdarliq)\b.*\b(gelib|gonderilib|almisam|catib|tanimisam|qoyublar|teqdim olunub)\b/]);
    case 25:
      return hasAny(normalizedText, [/\b(eve gelibler|unvana baxis|unvan uzre yoxlama|vizit|gelib melumat veribler|eve yaxinlasiblar|unvanda gorus|yasayis yerime baxis|meni unvanda tapiblar)\b/]);
    case 26:
      return hasAny(normalizedText, [/\b(sonra zeng edin|bir azdan elaqe saxlayin|axs[ae]m zeng edin|sabah danisaq|munasib vaxtda elaqe saxlayin|mesgulam sonra zeng edin|gunorta zeng edin|bir nece saata zeng edin|iclasdayam sonra|hazirda danisa bilmirem|sonra ozum geri donus ederem|sabah seher zeng edin|uygun vaxtda danisariq|tekrar elaqe saxlayin)\b/]);
    case 27:
      return hasAny(normalizedText, [/\b(xaric|rusiyada|turkiyede|avropada|azerbaycanda deyil|olkede deyil|olkeden kenar\w*|olkeden qirag\w*|azerbaycandan kenar\w*|seferde|qayidanda|geri qayidanda|xarici nomre|pul kocurende)\b/]);
    case 28:
      return hasAny(normalizedText, [/\b(xeste|xestexana|halim yaxsi deyil|sehhet|saglamliq|sagliq\w*|canim sag deyil|ozumu yaxsi hiss etmirem|hekim|derman|mualice|klinika|tibbi|muayine|isleye bilmirem)\b/]);
    case 29:
      return hasAny(normalizedText, [/\b(emeliyyat|cerrahiyye|reabilitasiya|tibbi prosedur|emeliyyatdan|ayaga qalxandan)\b/]);
    case 30:
      return hasAny(normalizedText, [/\b(qebz|cek|odenis senedi|odenis subutu|bank qebzi|ekran goruntusu|terminal qebzi|kocurme qebzi|odenis tesdiq)\b/]);
    case 31:
      return hasAny(normalizedText, [/\b(kredit)\b.*\b(xeberim yoxdur|goturmemisem|muraciet etmemisem|melumatim yoxdur|qebul etmir|sehvdir|muqavile baglamamisam)\b/, /\b(ilk defe esidirem|mene aid deyil|hec ne imzalamamisam|adimdan istifade|bu borcu tanimiram|arasdirilmasini isteyirem)\b/]);
    case 32:
      return hasAny(normalizedText, [/\b(yas|vefat|rehmete|defn|itirmisem|itirmisik|ailevi itki|yaxinimi|valideynimi|heyat yoldasimi|qardasimi|bacimi)\b/]);
    case 33:
      return hasAny(normalizedText, [/\b(herbi|esger|xidmetdeyem|xidmetde oldugum|herbi hisse|postdayam|novbedeyem|telimdeyem|komandirlik|herbi bolge|hissede xidmet)\b/]);
    case 34:
      return hasAny(normalizedText, [/\b(muellim|mekteb|tehsil|ders|sagird|universitet|tedris|imtahan|kursda ders)\b/]);
    case 35:
      return hasAny(normalizedText, [/\b(faiz\w*|cerime\w*|endirim|guzest|esas borc\w*|esas mebleg\w*|ana mebleg\w*|ustunde yigilan\w*|yigilanlar\w*|gecikme haqqi|kampaniya)\b/]) && hasAny(normalizedText, [/\b(sil|bagisla|cix\w*|azalt\w*|dayans\w*|tetbiq|isteyirem|mumkundur|baglayim|odeyim)\b/]);
    case 36:
      return hasAny(normalizedText, [/\b(huquqi merhele|huquqi sobe|huquqi proses|huquqi bolme|huquqi tedbir|huquqi arasdirma|huquqi icraat|huquqi status|mehkeme oncesi|mehkeme prosesi|resmi prosedur|resmi xeberdarliq|icra tedbirleri|mehkeme ucun hazirlanir|huquqsunaslar baxir)\b/]);
    case 37:
      return hasAny(normalizedText, [/\b(odenis link|odeme ucun sehife|odenis sehife|link at|link gonder|online odenis|onlayn odenis|odenis kecid|kecid gonder|kecid gondere|whatsapp a link|sms ile link|haradan odeyim|kartla ode|kartla odemek|sayt link|elektron odenis)\b/]);
    case 38:
      return hasAny(normalizedText, [/\b(bas ofis|filial|ofis|sexsen yaxinlas|yerinde hell|merkezi ofis|sirket[eə] yaxinlas|filial unvani)\b/]);
    case 39:
      return hasAny(normalizedText, [/\b(nomre|xett|sim kart|elaqe nomrem|telefon nomresi)\b.*\b(aktiv deyil|baglanib|deaktiv|islemir|deyisib|legv olunub|istifadede deyil|sondurulub|girim yoxdur|yeni nomre|fealiyyet gostermir)\b/, /\bkohne nomremdir\b/]);
    case 40:
      return hasAny(normalizedText, [/\b(gundelik|gunemuzd|gunluk|stabil maasim yoxdur|is olsa pul qazan|is cixsa|gunluk gelir|gunemuzd fehle|tikintide gunluk|taksi surub gunluk|bazarda isleyirem|daimi isim yoxdur)\b/]);
    case 41:
      return hasAny(normalizedText, [/\b(bonus|avans|sigorta pulu|kompensasiya|satisdan pul|ev satiram|masini sat|satisa qoy|torpaq satis|obyekti icareye|kiraye gelir|elave gelir|pul daxil olanda|pul gelende|alacagim var|satis tamamlanandan|alqı satqı|alqi satqi|kiraye pulu|sigorta odenisi|avans yatandan)\b/]);
    case 42:
      return hasAny(normalizedText, [/\b(yeni ise baslamisam|movsumi isleyirem|taksi sururem|tikintide isleyirem|fermer|ekin movsumu|mal qara|obyektim baglanib|biznesim zeif|satislar zeif|gelir evvelki kimi deyil|isler duzelende|movsum acilanda|qazanc zeif|musteri azdir|ticaret zeif|mehsul satandan)\b/]);
    case 43:
      return hasAny(normalizedText, [/\b(muqavileli herbci|dovlet iscisi|hekimem|dtx|fhn|dsx|dovlet qurumu|dovlet maasi|resmi is yerim|dovlet xidmetinde|is yerimle bagli mehdudiyyet)\b/]);
    default:
      return false;
  }
}

export function matchSummaryCategories(transcript: string | null | undefined): SummaryMatch[] {
  const source = customerTranscriptOnly(String(transcript || ""));
  const normalizedText = normalizeForSummary(source);
  if (!normalizedText) return [];

  const tokenSet = new Set(normalizedText.split(" ").filter(Boolean));
  const matches: SummaryMatch[] = [];

  for (const category of SUMMARY_CATEGORIES) {
    const matchedPhrases = category.phrases.filter((phrase) => phraseMatches(normalizedText, tokenSet, phrase));
    if (matchedPhrases.length > 0 || logicalCategoryMatches(category.id, normalizedText)) {
      matches.push({ id: category.id, title: category.title, matchedPhrases });
    }
  }

  return matches;
}

export function summarizeTranscript(transcript: string | null | undefined) {
  const matches = matchSummaryCategories(transcript);
  return matches.length > 0 ? matches.map((match) => match.title).join("; ") : null;
}

function clampTranscriptForSummary(transcript: string) {
  const normalized = transcript.trim();
  if (normalized.length <= postCallSummaryMaxTranscriptChars) return normalized;
  return normalized.slice(Math.max(0, normalized.length - postCallSummaryMaxTranscriptChars));
}

function parseSummaryIds(text: string) {
  const validIds = new Set(SUMMARY_CATEGORIES.map((category) => category.id));
  const jsonArray = text.match(/\[[\s\S]*?\]/)?.[0];
  let values: unknown[] = [];

  if (jsonArray) {
    try {
      const parsed = JSON.parse(jsonArray);
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      values = [];
    }
  }

  if (values.length === 0) {
    values = text.match(/\b\d{1,2}\b/g) || [];
  }

  return Array.from(new Set(values
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id) && validIds.has(id))));
}

function formatSummaryByIds(ids: number[]) {
  const idSet = new Set(ids);
  const titles = SUMMARY_CATEGORIES
    .filter((category) => idSet.has(category.id))
    .map((category) => category.title);
  return titles.length > 0 ? titles.join("; ") : null;
}

function filterAiSummaryIds(ids: number[], normalizedText: string) {
  return ids.filter((id) => {
    if (id !== 43) return true;
    if (/\btaksi\w*\b/.test(normalizedText)) {
      return hasAny(normalizedText, [/\b(dovlet|dtx|fhn|dsx|herbci|herbi|guc struktur|xususi xidmet|forma xidmeti)\b/]);
    }
    return true;
  });
}

function buildAiSummaryPrompt(transcript: string, deterministicMatches: SummaryMatch[]) {
  const categories = SUMMARY_CATEGORIES
    .map((category) => `${category.id}. ${category.title}: ${category.phrases.slice(0, 8).join("; ")}`)
    .join("\n");
  const deterministic = deterministicMatches.length > 0
    ? deterministicMatches.map((match) => `${match.id}. ${match.title}`).join("; ")
    : "yoxdur";

  return `Telefon danışığını oxu və müştərinin dediklərinə əsasən uyğun summary kateqoriya ID-lərini seç.

Qaydalar:
- Yalnız aşağıdakı kateqoriyalardan ID seç.
- Dəqiq fraza olmasa da, müştərinin mənasına görə məntiqi nəticə çıxar.
- Müştəri ödəməyə söz verirsə, tarix göstərirsə, imtina edirsə, tanımadığını deyirsə, maaş/pensiya gözləyirsə və ya hüquqi/icra mövzusu açırsa uyğun kateqoriyanı seç.
- Agentin dediklərinə yox, əsasən müştərinin və ya ailə üzvünün cavabına əsaslan.
- "Ay qardaş", "qardaş", "bacı" kimi müraciət sözləri ailə üzvü demək deyil; 1-ci kateqoriyanı yalnız danışan şəxs açıq şəkildə "mən onun qardaşıyam/atasıyam/anasıyam/qohumuyam" kimi özünü ailə üzvü kimi təqdim edəndə seç.
- "Taksi sürürəm" və ya "taksidə qazanc düşüb" öz-özlüyündə dövlət/xüsusi xidmət deyil; dövlət, DTX, FHN, DSX, hərbi və ya xüsusi xidmət açıq deyilmirsə 43-cü kateqoriyanı seçmə.
- Əmin deyilsənsə ID əlavə etmə, amma açıq məna varsa boş qaytarma.
- Cavabda yalnız JSON array qaytar, məsələn: [21,22]

Regex ilə tapılan ilkin nəticə: ${deterministic}

Kateqoriyalar:
${categories}

Transcript:
${clampTranscriptForSummary(transcript)}`;
}

export async function summarizeTranscriptWithAi(transcript: string | null | undefined) {
  const source = String(transcript || "").trim();
  const deterministicMatches = matchSummaryCategories(source);
  const deterministicIds = deterministicMatches.map((match) => match.id);

  if (!source) return null;
  if (!postCallSummaryAiEnabled || !process.env.GEMINI_API_KEY) {
    return formatSummaryByIds(deterministicIds);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const request = ai.models.generateContent({
      model: postCallSummaryModel,
      contents: [{ role: "user", parts: [{ text: buildAiSummaryPrompt(source, deterministicMatches) }] }],
      config: { temperature: 0 },
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`post-call summary timed out after ${postCallSummaryTimeoutMs}ms`)), postCallSummaryTimeoutMs);
    });
    const response = await Promise.race([request, timeout]);
    await recordAiTokenUsage({
      model: postCallSummaryModel,
      operation: "post_call_summary",
      usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata as never,
    });
    const aiIds = filterAiSummaryIds(parseSummaryIds(response.text || ""), normalizeForSummary(customerTranscriptOnly(source)));
    return formatSummaryByIds([...deterministicIds, ...aiIds]);
  } catch (error) {
    console.error("Failed to build AI call summary", error);
    return formatSummaryByIds(deterministicIds);
  }
}

export function buildSummaryCategoryGuide() {
  const lines = SUMMARY_CATEGORIES.map((category) => `${category.id}. ${category.title}: ${category.phrases.join("; ")}`);
  return `

Daxili summary qaydası:
- Aşağıdakı siyahı yalnız danışıqdan sonra daxili kateqoriya çıxarmaq üçündür.
- Bu kateqoriya adlarını və siyahını müştəriyə demə.
- Müştərinin sözlərində bu məntiqi ifadələrdən biri görünəndə həmin summary kateqoriyası uyğun sayılır.

Summary kateqoriyaları:
${lines.join("\n")}`;
}
