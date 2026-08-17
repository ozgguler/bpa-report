/**
 * BPA rapor ureteci — tarayici tarafi.
 *
 * bpa_report.py'nin birebir portu. Ayni HTML/CSS'i uretir; boylece Python
 * prototipiyle dogrulanan tasarim aynen korunur.
 *
 * PDF stratejisi: zengin CSS Paged Media duzenini yeniden kurmak yerine
 * tarayicinin kendi yazdirma motoru kullanilir (window.print -> "PDF olarak
 * kaydet"). Tipografi kusursuz, harici kutuphane sifir.
 *
 * NOT: bpa_report.py ile bu dosya ayni ciktiyi uretmelidir. Uretimde Python
 * surumu kaldirilacak; su an referans/karsilastirma icin duruyor.
 */

const SEV_ORDER = ['Critical', 'High', 'Warning', 'Informational'];
const SEC_ORDER = ['device', 'network', 'policies', 'objects'];

// Olcek sinirlari — kurumsal cihazlarda 1000+ kural olabilir.
const MATRIX_FULL_LIMIT = 45;
const WORST_LIMIT = 25;
const PATTERN_LIMIT = 12;
const ZONE_LIMIT = 25;
const PROFILE_NAME_LIMIT = 12;

const PROFILE_TYPES = ['antivirus_profile', 'anti_spyware_profile', 'url_filtering_profile',
  'file_blocking_profile', 'vulnerability_protection_profile', 'wildfire_analysis_profile',
  'decryption_profile', 'log_forwarding_profile', 'data_filtering_profile'];

export const STR = {
  tr: {
    title: 'Best Practice Assessment',
    subtitle: 'Güvenlik Konfigürasyonu Uygunluk Raporu',
    device: 'Cihaz', model: 'Model', serial: 'Seri numarası',
    panos: 'PAN-OS sürümü', ip: 'Yönetim adresi', generated: 'Rapor tarihi',
    vsys: 'Sanal sistem',
    score: 'Uygunluk skoru',
    score_note: 'Uygun kontrollerin, değerlendirmeye giren toplam kontrole oranı. Kapsam dışı kontroller hesaba katılmaz.',
    exec: 'Yönetici Özeti',
    passed: 'Uygun', failed: 'Uygun değil', excluded: 'Kapsam dışı',
    total: 'Toplam', severity: 'Önem derecesi',
    distinct: 'Farklı bulgu', distinct_crit: 'Kritik bulgu',
    instances: 'Etkilenen nesne',
    skew_note: 'Uygunsuzlukların {pct}\'i yalnızca {k} farklı kontrolden kaynaklanıyor; '
             + 'en büyüğü tek başına {n} nesneyi etkiliyor. Düzeltme nesne nesne değil, '
             + 'bulgu bazında planlanmalıdır.',
    sev_Critical: 'Kritik', sev_High: 'Yüksek', sev_Warning: 'Orta', sev_Informational: 'Bilgilendirme',
    distribution: 'Önem derecesine göre dağılım',
    sections: 'Alanlara göre dağılım',
    sec_device: 'Cihaz ayarları', sec_network: 'Ağ', sec_policies: 'Politikalar', sec_objects: 'Nesneler',
    adoption: 'Politika Kullanım Oranları',
    adoption_note: 'Güvenlik kurallarının konfigürasyonundan hesaplanmıştır. Sistem tarafından oluşturulan varsayılan kurallar hesaba katılmamıştır.',
    ad_app: 'Uygulama tabanlı kural', ad_user: 'Kullanıcı tabanlı kural',
    ad_svc: 'Servis/port kısıtı', ad_log: 'Oturum sonunda loglama',
    ad_fwd: 'Log yönlendirme', ad_prof: 'Güvenlik profili bağlı',
    ad_app_d: 'application alanı «any» dışında tanımlanmış kurallar',
    ad_user_d: 'source-user alanı «any» dışında tanımlanmış kurallar',
    ad_svc_d: 'Servis veya application-default tanımlı kurallar',
    ad_log_d: 'Oturum sonunda kayıt tutan kurallar',
    ad_fwd_d: 'Logları harici bir hedefe ileten kurallar',
    ad_prof_d: 'En az bir güvenlik profili veya profil grubu bağlı kurallar',
    decryption: 'Şifre Çözme Durumu',
    dec_fwd: 'SSL Forward Proxy', dec_in: 'SSL Inbound Inspection',
    dec_ssh: 'SSH Proxy', dec_prof: 'Şifre çözme profili kullanımı',
    configured: 'Etkin', notconfigured: 'Etkin değil',
    dec_note: 'Yalnızca etkin (devre dışı bırakılmamış) ve şifre çözme aksiyonuna sahip kurallar dikkate alınır.',
    heat: 'Uygunsuzluk Yoğunluğu',
    heat_note: 'Değerlendirilen konfigürasyon alanlarının her birindeki uygunsuzluk sayısı. Çubuğun kırmızı bölümü uygun olmayan, yeşil bölümü uygun, gri bölümü kapsam dışı kontrolleri gösterir.',
    heat_clean: 'Tam uygun alanlar',
    matrix: 'Güvenlik Kuralı Kapsam Matrisi',
    matrix_note: 'Her kuralın hangi denetim mekanizmalarını kullandığını gösterir. Trafiğe izin veren ancak güvenlik profili bağlı olmayan kurallar işaretlenmiştir — bu kurallardan geçen trafik içerik denetiminden geçmez.',
    m_rule: 'Kural', m_action: 'Aksiyon', m_app: 'App-ID',
    m_user: 'User-ID', m_svc: 'Servis', m_prof: 'Profil', m_log: 'Log',
    m_risk: 'İzin veren, profilsiz kural',
    patterns: 'Eksik Denetim Kalıpları',
    patterns_note: 'Kural sayısı tam listeleme için fazla olduğundan, aynı eksikleri paylaşan kurallar gruplanmıştır. Düzeltme genellikle kural kural değil, kalıp kalıp yapılır — bir profil grubu tanımlayıp aynı boşluğa sahip tüm kurallara uygulamak gibi.',
    p_missing: 'Eksik denetimler', p_count: 'Kural', p_examples: 'Örnekler', p_none: 'Eksik yok',
    worst: 'En Yüksek Riskli Kurallar',
    worst_note: 'Risk puanı; trafiğe izin veren ve güvenlik profili bağlı olmayan kurallara ağırlık verir. Devre dışı kurallar puanlanmaz.',
    w_risk: 'Risk',
    scale_note: '{n} kural değerlendirildi. Tam liste bu rapora sığmayacağı için kalıp analizi ve en riskli {k} kural gösterilmektedir; kural bazında tam döküm ayrı bir çıktı olarak alınabilir.',
    more: 'diğer',
    zones: 'Bölge (Zone) Duruşu',
    zones_note: 'Zone Protection profili, flood ve reconnaissance saldırılarına karşı ilk savunma katmanıdır.',
    z_name: 'Bölge', z_prot: 'Zone Protection', z_pbp: 'Packet Buffer Protection',
    z_uid: 'User-ID', z_log: 'Log ayarı',
    inventory: 'Güvenlik Profili Envanteri',
    inventory_note: 'Cihazda tanımlı profiller ve her birinde tespit edilen uygunsuzluk sayısı.',
    i_type: 'Profil türü', i_names: 'Tanımlı profiller', i_count: 'Adet', i_fail: 'Uygunsuzluk',
    findings: 'Bulgular',
    findings_note: 'Bulgular kontrol kimliğine göre gruplanmıştır. Bir kontrol birden çok nesnede başarısız olabilir; etkilenen nesneler her bulgunun altında listelenir.',
    affected: 'Etkilenen nesneler', remediation: 'Çözüm önerisi',
    failedfields: 'Uygun olmayan alanlar', occurrences: 'nesnede',
    top: 'Öncelikli Bulgular',
    top_note: 'Kritik önem derecesindeki uygunsuzluklar, etkilenen nesne sayısına göre sıralı.',
    rulestats: 'Güvenlik kuralı sayıları',
    rs_total: 'Toplam', rs_allow: 'İzin', rs_deny: 'Red', rs_disabled: 'Devre dışı',
    appendix: 'Ek — Kapsam ve Yöntem',
    appendix_body: 'Bu rapor, cihazdan alınan konfigürasyonun Palo Alto Networks Strata Cloud Manager Posture API\'sine gönderilmesiyle üretilen makine okunabilir sonucun biçimlendirilmiş hâlidir. Değerlendirme yalnızca konfigürasyona dayanır; trafik, log ve çalışma zamanı verisi kapsam dışıdır. Kontrol adları ve çözüm önerileri Palo Alto Networks tarafından tanımlanır ve İngilizce sağlanır. «Kapsam dışı» olarak işaretlenen kontroller skora dahil edilmez.',
    nofindings: 'Bu alanda uygunsuzluk tespit edilmedi.',
    yes: 'Var', no: 'Yok',
    print: 'PDF olarak kaydet',
  },
  en: {
    title: 'Best Practice Assessment',
    subtitle: 'Security Configuration Compliance Report',
    device: 'Device', model: 'Model', serial: 'Serial number',
    panos: 'PAN-OS version', ip: 'Management address', generated: 'Report date',
    vsys: 'Virtual system',
    score: 'Compliance score',
    score_note: 'Compliant checks as a share of all assessed checks. Out-of-scope checks are not counted.',
    exec: 'Executive Summary',
    passed: 'Compliant', failed: 'Non-compliant', excluded: 'Out of scope',
    total: 'Total', severity: 'Severity',
    distinct: 'Distinct findings', distinct_crit: 'Critical findings',
    instances: 'Affected objects',
    skew_note: '{pct} of all non-compliant results come from just {k} distinct checks; '
             + 'the largest one alone affects {n} objects. Remediation should be planned '
             + 'per finding, not per object.',
    sev_Critical: 'Critical', sev_High: 'High', sev_Warning: 'Medium', sev_Informational: 'Informational',
    distribution: 'Distribution by severity',
    sections: 'Distribution by area',
    sec_device: 'Device settings', sec_network: 'Network', sec_policies: 'Policies', sec_objects: 'Objects',
    adoption: 'Policy Adoption',
    adoption_note: 'Computed from security rule configuration. System-generated default rules are excluded.',
    ad_app: 'Application-based rules', ad_user: 'User-based rules',
    ad_svc: 'Service/port restriction', ad_log: 'Log at session end',
    ad_fwd: 'Log forwarding', ad_prof: 'Security profile attached',
    ad_app_d: 'Rules where application is set to something other than “any”',
    ad_user_d: 'Rules where source-user is set to something other than “any”',
    ad_svc_d: 'Rules with an explicit service or application-default',
    ad_log_d: 'Rules logging at session end',
    ad_fwd_d: 'Rules forwarding logs to an external destination',
    ad_prof_d: 'Rules with at least one security profile or group attached',
    decryption: 'Decryption Posture',
    dec_fwd: 'SSL Forward Proxy', dec_in: 'SSL Inbound Inspection',
    dec_ssh: 'SSH Proxy', dec_prof: 'Decryption profile in use',
    configured: 'Active', notconfigured: 'Not active',
    dec_note: 'Only enabled rules with a decrypt action are counted.',
    heat: 'Where Issues Concentrate',
    heat_note: 'Non-compliant checks across each assessed configuration area. Red is non-compliant, green is compliant, grey is out of scope.',
    heat_clean: 'Fully compliant areas',
    matrix: 'Security Rule Coverage Matrix',
    matrix_note: 'Shows which controls each rule uses. Rules that allow traffic without a security profile are flagged — traffic matching those rules is not content-inspected.',
    m_rule: 'Rule', m_action: 'Action', m_app: 'App-ID',
    m_user: 'User-ID', m_svc: 'Service', m_prof: 'Profile', m_log: 'Log',
    m_risk: 'Allows traffic, no profile',
    patterns: 'Control Gap Patterns',
    patterns_note: 'There are too many rules to list individually, so rules sharing the same gaps are grouped. Remediation is usually done per pattern rather than per rule — for example defining one profile group and applying it to every rule with the same gap.',
    p_missing: 'Missing controls', p_count: 'Rules', p_examples: 'Examples', p_none: 'No gaps',
    worst: 'Highest-Risk Rules',
    worst_note: 'The risk score weights rules that allow traffic without a security profile. Disabled rules are not scored.',
    w_risk: 'Risk',
    scale_note: '{n} rules assessed. The full list would not fit in this report, so pattern analysis and the {k} highest-risk rules are shown; a complete per-rule export can be produced separately.',
    more: 'more',
    zones: 'Zone Posture',
    zones_note: 'A Zone Protection profile is the first line of defence against flood and reconnaissance attacks.',
    z_name: 'Zone', z_prot: 'Zone Protection', z_pbp: 'Packet Buffer Protection',
    z_uid: 'User-ID', z_log: 'Log setting',
    inventory: 'Security Profile Inventory',
    inventory_note: 'Profiles defined on the device and the number of non-compliant checks found in each.',
    i_type: 'Profile type', i_names: 'Defined profiles', i_count: 'Count', i_fail: 'Non-compliant',
    findings: 'Findings',
    findings_note: 'Findings are grouped by check. A single check may fail on multiple objects; affected objects are listed under each finding.',
    affected: 'Affected objects', remediation: 'Recommendation',
    failedfields: 'Non-compliant fields', occurrences: 'objects',
    top: 'Priority Findings',
    top_note: 'Critical-severity non-compliant checks, ordered by number of affected objects.',
    rulestats: 'Security rule counts',
    rs_total: 'Total', rs_allow: 'Allow', rs_deny: 'Deny', rs_disabled: 'Disabled',
    appendix: 'Appendix — Scope and Method',
    appendix_body: 'This report is a formatted rendering of the machine-readable result produced by submitting the device configuration to the Palo Alto Networks Strata Cloud Manager Posture API. The assessment is configuration-based only; traffic, logs and runtime data are out of scope. Check names and recommendations are defined by Palo Alto Networks and provided in English. Checks marked “out of scope” do not contribute to the score.',
    nofindings: 'No non-compliant checks in this area.',
    yes: 'Yes', no: 'No',
    print: 'Save as PDF',
  },

  ru: {
    title: 'Best Practice Assessment',
    subtitle: 'Отчёт о соответствии конфигурации безопасности',
    device: 'Устройство', model: 'Модель', serial: 'Серийный номер',
    panos: 'Версия PAN-OS', ip: 'Адрес управления', generated: 'Дата отчёта',
    vsys: 'Виртуальная система',
    score: 'Показатель соответствия',
    score_note: 'Доля соответствующих проверок от общего числа оценённых. '
              + 'Проверки вне области оценки не учитываются.',
    exec: 'Сводка для руководства',
    passed: 'Соответствует', failed: 'Не соответствует', excluded: 'Вне области оценки',
    total: 'Всего', severity: 'Уровень критичности',
    distinct: 'Уникальных замечаний', distinct_crit: 'Критических замечаний',
    instances: 'Затронутых объектов',
    skew_note: '{pct} всех несоответствий вызваны всего {k} проверками; '
             + 'наибольшая из них затрагивает {n} объектов. Устранение следует планировать '
             + 'по замечаниям, а не по отдельным объектам.',
    sev_Critical: 'Критический', sev_High: 'Высокий',
    sev_Warning: 'Средний', sev_Informational: 'Информационный',
    distribution: 'Распределение по критичности',
    sections: 'Распределение по областям',
    sec_device: 'Настройки устройства', sec_network: 'Сеть',
    sec_policies: 'Политики', sec_objects: 'Объекты',
    adoption: 'Применение политик',
    adoption_note: 'Рассчитано на основе конфигурации правил безопасности. '
                 + 'Системные правила по умолчанию не учитываются.',
    ad_app: 'Правила на основе приложений', ad_user: 'Правила на основе пользователей',
    ad_svc: 'Ограничение по сервису/порту', ad_log: 'Журналирование в конце сессии',
    ad_fwd: 'Пересылка журналов', ad_prof: 'Привязан профиль безопасности',
    ad_app_d: 'Правила, где application задан не как «any»',
    ad_user_d: 'Правила, где source-user задан не как «any»',
    ad_svc_d: 'Правила с явным сервисом или application-default',
    ad_log_d: 'Правила, ведущие журнал в конце сессии',
    ad_fwd_d: 'Правила, пересылающие журналы во внешнее хранилище',
    ad_prof_d: 'Правила хотя бы с одним профилем или группой профилей безопасности',
    decryption: 'Состояние расшифрования',
    dec_fwd: 'SSL Forward Proxy', dec_in: 'SSL Inbound Inspection',
    dec_ssh: 'SSH Proxy', dec_prof: 'Использование профиля расшифрования',
    configured: 'Включено', notconfigured: 'Не включено',
    dec_note: 'Учитываются только активные правила с действием расшифрования.',
    heat: 'Концентрация несоответствий',
    heat_note: 'Число несоответствующих проверок по каждой оценённой области конфигурации. '
             + 'Красный — не соответствует, зелёный — соответствует, серый — вне области оценки.',
    heat_clean: 'Области с полным соответствием',
    matrix: 'Матрица покрытия правил безопасности',
    matrix_note: 'Показывает, какие механизмы контроля использует каждое правило. '
               + 'Правила, разрешающие трафик без профиля безопасности, отмечены — '
               + 'проходящий по ним трафик не проверяется на уровне контента.',
    m_rule: 'Правило', m_action: 'Действие', m_app: 'App-ID',
    m_user: 'User-ID', m_svc: 'Сервис', m_prof: 'Профиль', m_log: 'Журнал',
    m_risk: 'Разрешает трафик без профиля',
    patterns: 'Типовые пробелы в контроле',
    patterns_note: 'Правил слишком много для полного перечисления, поэтому правила '
                 + 'с одинаковыми пробелами сгруппированы. Устранение обычно выполняется '
                 + 'по типам, а не по отдельным правилам — например, одна группа профилей '
                 + 'применяется ко всем правилам с тем же пробелом.',
    p_missing: 'Отсутствующие механизмы', p_count: 'Правил',
    p_examples: 'Примеры', p_none: 'Пробелов нет',
    worst: 'Правила с наибольшим риском',
    worst_note: 'Оценка риска отдаёт приоритет правилам, которые разрешают трафик без '
              + 'профиля безопасности. Отключённые правила не оцениваются.',
    w_risk: 'Риск',
    scale_note: 'Оценено правил: {n}. Полный список не помещается в отчёт, поэтому '
              + 'приведены анализ типовых пробелов и {k} правил с наибольшим риском; '
              + 'полная выгрузка по правилам может быть подготовлена отдельно.',
    more: 'ещё',
    zones: 'Состояние зон',
    zones_note: 'Профиль Zone Protection — первый рубеж защиты от флуд-атак и разведки.',
    z_name: 'Зона', z_prot: 'Zone Protection', z_pbp: 'Packet Buffer Protection',
    z_uid: 'User-ID', z_log: 'Настройка журналирования',
    inventory: 'Инвентаризация профилей безопасности',
    inventory_note: 'Профили, определённые на устройстве, и число выявленных в каждом '
                  + 'несоответствий.',
    i_type: 'Тип профиля', i_names: 'Определённые профили',
    i_count: 'Кол-во', i_fail: 'Несоответствий',
    findings: 'Замечания',
    findings_note: 'Замечания сгруппированы по идентификатору проверки. Одна проверка может '
                 + 'не пройти на нескольких объектах; затронутые объекты перечислены под '
                 + 'каждым замечанием.',
    affected: 'Затронутые объекты', remediation: 'Рекомендация',
    failedfields: 'Несоответствующие поля', occurrences: 'объектов',
    top: 'Приоритетные замечания',
    top_note: 'Несоответствия критического уровня, упорядоченные по числу затронутых объектов.',
    rulestats: 'Количество правил безопасности',
    rs_total: 'Всего', rs_allow: 'Разрешить', rs_deny: 'Запретить', rs_disabled: 'Отключено',
    appendix: 'Приложение — область и метод оценки',
    appendix_body: 'Отчёт представляет собой оформленное представление машиночитаемого '
                 + 'результата, полученного при отправке конфигурации устройства в Posture API '
                 + 'Palo Alto Networks Strata Cloud Manager. Оценка основана исключительно на '
                 + 'конфигурации; трафик, журналы и данные времени выполнения не входят в '
                 + 'область оценки. Названия проверок и рекомендации определены Palo Alto '
                 + 'Networks и предоставляются на английском языке. Проверки, отмеченные как '
                 + '«вне области оценки», не влияют на итоговый показатель.',
    nofindings: 'Несоответствий в этой области не выявлено.',
    yes: 'Есть', no: 'Нет',
    print: 'Сохранить в PDF',
  },
};

const CT_LABEL = {
  tr: {
    security_rule: 'Güvenlik kuralları', security_rulebase: 'Kural tabanı (genel)',
    decryption_rule: 'Şifre çözme kuralları', decryption_rulebase: 'Şifre çözme kural tabanı',
    app_override: 'Application Override', zone: 'Bölgeler',
    ipsec_crypto_profile: 'IPSec kripto profilleri', ike_crypto_profiles: 'IKE kripto profilleri',
    global_protect_gateway: 'GlobalProtect Gateway', global_protect_portal: 'GlobalProtect Portal',
    interface_management_profile: 'Arayüz yönetim profili',
    authentication_profile: 'Kimlik doğrulama profili', certificate: 'Sertifikalar',
    dynamic_updates: 'Dinamik içerik güncellemeleri', ssl_tls_service_profile: 'SSL/TLS servis profili',
    log_settings_system: 'Sistem log ayarları', log_settings_config: 'Config log ayarları',
    device_setup_management_interface: 'Yönetim arayüzü', device_setup_services: 'Servisler',
    device_setup_session: 'Oturum ayarları', 'device_setup_session-timeouts': 'Oturum zaman aşımları',
    device_setup_minimum_password_complexity: 'Parola karmaşıklığı',
    device_setup_policy_rulebase: 'Politika kural tabanı',
    device_setup_secure_communication: 'Güvenli iletişim',
    device_setup_logging_reporting: 'Loglama ve raporlama',
    device_setup_authentication: 'Yönetici kimlik doğrulama',
    device_setup_telemetry: 'Telemetri', device_setup_general: 'Genel ayarlar',
    user_id: 'User-ID',
    antivirus_profile: 'Antivirüs profilleri', anti_spyware_profile: 'Anti-Spyware profilleri',
    url_filtering_profile: 'URL filtreleme profilleri', file_blocking_profile: 'Dosya engelleme profilleri',
    vulnerability_protection_profile: 'Zafiyet koruma profilleri',
    wildfire_analysis_profile: 'WildFire analiz profilleri', decryption_profile: 'Şifre çözme profilleri',
    log_forwarding_profile: 'Log yönlendirme profilleri', data_filtering_profile: 'Veri filtreleme profilleri',
  },
  en: {
    security_rule: 'Security rules', security_rulebase: 'Rulebase (overall)',
    decryption_rule: 'Decryption rules', decryption_rulebase: 'Decryption rulebase',
    app_override: 'Application Override', zone: 'Zones',
    ipsec_crypto_profile: 'IPSec crypto profiles', ike_crypto_profiles: 'IKE crypto profiles',
    global_protect_gateway: 'GlobalProtect Gateway', global_protect_portal: 'GlobalProtect Portal',
    interface_management_profile: 'Interface management profile',
    authentication_profile: 'Authentication profile', certificate: 'Certificates',
    dynamic_updates: 'Dynamic content updates', ssl_tls_service_profile: 'SSL/TLS service profile',
    log_settings_system: 'System log settings', log_settings_config: 'Config log settings',
    device_setup_management_interface: 'Management interface', device_setup_services: 'Services',
    device_setup_session: 'Session settings', 'device_setup_session-timeouts': 'Session timeouts',
    device_setup_minimum_password_complexity: 'Password complexity',
    device_setup_policy_rulebase: 'Policy rulebase',
    device_setup_secure_communication: 'Secure communication',
    device_setup_logging_reporting: 'Logging and reporting',
    device_setup_authentication: 'Administrator authentication',
    device_setup_telemetry: 'Telemetry', device_setup_general: 'General settings',
    user_id: 'User-ID',
    antivirus_profile: 'Antivirus profiles', anti_spyware_profile: 'Anti-Spyware profiles',
    url_filtering_profile: 'URL filtering profiles', file_blocking_profile: 'File blocking profiles',
    vulnerability_protection_profile: 'Vulnerability protection profiles',
    wildfire_analysis_profile: 'WildFire analysis profiles', decryption_profile: 'Decryption profiles',
    log_forwarding_profile: 'Log forwarding profiles', data_filtering_profile: 'Data filtering profiles',
  },
  ru: {
    security_rule: 'Правила безопасности', security_rulebase: 'База правил (в целом)',
    decryption_rule: 'Правила расшифрования', decryption_rulebase: 'База правил расшифрования',
    app_override: 'Application Override', zone: 'Зоны',
    ipsec_crypto_profile: 'Криптопрофили IPSec', ike_crypto_profiles: 'Криптопрофили IKE',
    global_protect_gateway: 'GlobalProtect Gateway', global_protect_portal: 'GlobalProtect Portal',
    interface_management_profile: 'Профиль управления интерфейсом',
    authentication_profile: 'Профиль аутентификации', certificate: 'Сертификаты',
    dynamic_updates: 'Динамические обновления контента',
    ssl_tls_service_profile: 'Сервисный профиль SSL/TLS',
    log_settings_system: 'Настройки системного журнала',
    log_settings_config: 'Настройки журнала конфигурации',
    device_setup_management_interface: 'Интерфейс управления', device_setup_services: 'Сервисы',
    device_setup_session: 'Параметры сессий', 'device_setup_session-timeouts': 'Тайм-ауты сессий',
    device_setup_minimum_password_complexity: 'Сложность паролей',
    device_setup_policy_rulebase: 'База политик',
    device_setup_secure_communication: 'Защищённое взаимодействие',
    device_setup_logging_reporting: 'Журналирование и отчётность',
    device_setup_authentication: 'Аутентификация администраторов',
    device_setup_telemetry: 'Телеметрия', device_setup_general: 'Общие параметры',
    user_id: 'User-ID',
    antivirus_profile: 'Антивирусные профили', anti_spyware_profile: 'Профили Anti-Spyware',
    url_filtering_profile: 'Профили URL-фильтрации',
    file_blocking_profile: 'Профили блокировки файлов',
    vulnerability_protection_profile: 'Профили защиты от уязвимостей',
    wildfire_analysis_profile: 'Профили анализа WildFire',
    decryption_profile: 'Профили расшифрования',
    log_forwarding_profile: 'Профили пересылки журналов',
    data_filtering_profile: 'Профили фильтрации данных',
  },
};

// ---------------------------------------------------------------------------
// Veri cikarma
// ---------------------------------------------------------------------------

function flatten(report) {
  const rows = [];
  for (const [sec, sval] of Object.entries(report.best_practices || {})) {
    if (!sval || typeof sval !== 'object') continue;
    for (const [ctype, cval] of Object.entries(sval)) {
      if (!cval) continue;
      for (const item of (Array.isArray(cval) ? cval : [cval])) {
        if (!item || typeof item !== 'object') continue;
        const cfg = item.configuration || {};
        const obj = cfg.name || cfg.location || ctype;
        for (const w of (item.warnings || [])) {
          if (!w || typeof w !== 'object') continue;
          rows.push({
            section: sec, ctype, object: String(obj),
            status: w.check_excluded ? 'Excluded' : w.check_passed ? 'Passed' : 'Failed',
            // API'de 'severity' HER ZAMAN bostur; check_type kullanilir
            severity: w.check_type || 'Informational',
            id: w.check_id,
            name: (w.check_name || '').trim(),
            message: (w.check_message || '').trim(),
            failedFields: w.failed_fields || {},
          });
        }
      }
    }
  }
  return rows;
}

function isSet(v) {
  if (v == null) return false;
  if (typeof v === 'string') return !['', 'any', 'none'].includes(v.trim());
  if (Array.isArray(v)) {
    const vals = v.map(x => String(x).trim()).filter(Boolean);
    return vals.length > 0 && !(vals.length === 1 && vals[0] === 'any');
  }
  if (typeof v === 'object') return Object.values(v).some(isSet);
  return Boolean(v);
}

function userRules(report) {
  const rules = report?.best_practices?.policies?.security_rule || [];
  return rules.filter(r => r && typeof r === 'object')
    .map(r => r.configuration || {})
    .filter(c => String(c.is_default_security_rule ?? 'false').toLowerCase() !== 'true');
}

function ruleFlags(c) {
  const ps = c.profile_setting || {};
  const prof = isSet(ps.group)
    || Object.values(ps.profiles || {}).some(isSet)
    || Object.keys(c).some(k => k.startsWith('profile_') && k !== 'profile_setting' && isSet(c[k]));
  const svc = c.service;
  const hasSvc = (Array.isArray(svc) && svc.some(x => String(x).trim() === 'application-default')) || isSet(svc);
  return {
    name: String(c.name || c.rule_name || '—'),
    action: String(c.action || '—'),
    disabled: String(c.disabled ?? 'no').toLowerCase() === 'yes',
    app: isSet(c.application || c.applications),
    user: isSet(c.source_user || c['source-user']),
    svc: hasSvc,
    prof,
    log: String(c.log_end || c['log-end'] || '').toLowerCase() === 'yes',
  };
}

/**
 * Risk mantigi: trafige IZIN VEREN ve guvenlik profili olmayan kural en yuksek
 * risktir — o trafik icerik denetiminden hic gecmez. Engelleyen kurallarda
 * profil eksikligi risk sayilmaz.
 */
function ruleGaps(report) {
  return userRules(report).map(c => {
    const f = ruleFlags(c);
    const allows = f.action === 'allow';
    f.miss = ['app', 'user', 'svc', 'prof', 'log'].filter(k => !f[k]);
    f.risk = f.disabled ? 0
      : (allows && !f.prof ? 3 : 0) + (allows ? f.miss.length : 0);
    return f;
  });
}

function gapPatterns(flags) {
  const buckets = new Map();
  for (const f of flags) {
    if (f.disabled) continue;
    const k = `${f.action}|${f.miss.join(',')}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(f);
  }
  return [...buckets.values()].map(v => ({
    action: v[0].action, miss: v[0].miss, n: v.length,
    risk: Math.max(...v.map(x => x.risk)),
    examples: v.slice(0, 3).map(x => x.name),
  })).sort((a, b) => b.n - a.n || b.risk - a.risk);
}

function computeAdoption(report) {
  const cfgs = userRules(report);
  const n = cfgs.length;
  if (!n) return null;
  const fl = cfgs.map(ruleFlags);
  const pct = key => {
    const k = fl.filter(f => f[key]).length;
    return { n: k, d: n, pct: 100 * k / n };
  };
  const fwdN = cfgs.filter(c => isSet(c.log_setting || c['log-setting'])).length;
  return {
    ad_app: pct('app'), ad_user: pct('user'), ad_svc: pct('svc'),
    ad_prof: pct('prof'), ad_log: pct('log'),
    ad_fwd: { n: fwdN, d: n, pct: 100 * fwdN / n },
  };
}

function computeDecryption(report) {
  const rules = (report?.best_practices?.policies?.decryption_rule || [])
    .filter(r => r && typeof r === 'object').map(r => r.configuration || {});
  const active = rules.filter(c => String(c.disabled ?? 'no').toLowerCase() !== 'yes');
  const typed = kind => active.some(c =>
    c.type && typeof c.type === 'object' && c.type[kind] &&
    String(c.action || '').toLowerCase() === 'decrypt');
  return {
    dec_fwd: typed('ssl_forward_proxy'),
    dec_in: typed('ssl_inbound_inspection'),
    dec_ssh: typed('ssh_proxy'),
    dec_prof: active.some(c => isSet(c.profile)),
  };
}

function zonePosture(report) {
  return (report?.best_practices?.network?.zone || [])
    .filter(r => r && typeof r === 'object').map(r => {
      const c = r.configuration || {};
      const n = c.network || {};
      return {
        name: String(c.name || '—'),
        prot: String(n.zone_protection_profile || c.zone_protection_profile || ''),
        pbp: String(n.enable_packet_buffer_protection || '').toLowerCase() === 'yes',
        uid: String(c.enable_user_identification || '').toLowerCase() === 'yes',
        log: String(n.log_setting || ''),
      };
    });
}

function profileInventory(report, lang) {
  const objs = report?.best_practices?.objects || {};
  const out = [];
  for (const t of PROFILE_TYPES) {
    const items = objs[t] || [];
    if (!items.length) continue;
    const names = [];
    let fails = 0;
    for (const i of items) {
      if (!i || typeof i !== 'object') continue;
      const nm = (i.configuration || {}).name;
      if (nm) names.push(String(nm));
      fails += (i.warnings || []).filter(w => w && !w.check_passed && !w.check_excluded).length;
    }
    out.push({ type: prettyCt(t, lang), names, count: items.length, fail: fails });
  }
  return out;
}

function ctStats(report) {
  const out = [];
  for (const [sec, sval] of Object.entries(report.best_practices || {})) {
    if (!sval || typeof sval !== 'object') continue;
    for (const [ct, cval] of Object.entries(sval)) {
      if (!cval) continue;
      const items = Array.isArray(cval) ? cval : [cval];
      let f = 0, p = 0, e = 0;
      for (const i of items) {
        if (!i || typeof i !== 'object') continue;
        for (const w of (i.warnings || [])) {
          if (!w || typeof w !== 'object') continue;
          if (w.check_excluded) e++; else if (w.check_passed) p++; else f++;
        }
      }
      out.push({ sec, ct, f, p, e, n: items.length, tot: f + p + e });
    }
  }
  return out;
}

function prettyCt(ct, lang) {
  const m = (CT_LABEL[lang] || {})[ct];
  if (m) return m;
  const s = ct.replace(/^(device_setup_|log_settings_)/, '').replace(/[_-]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Gorsel
// ---------------------------------------------------------------------------

const scoreClass = p => p >= 80 ? 's-good' : p >= 60 ? 's-ok' : p >= 35 ? 's-warn' : 's-bad';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const bar = (pct, label, sub = '') => `<div class="bar-row">
  <div class="bar-label"><span class="bl-main">${esc(label)}</span>
    ${sub ? `<span class="bl-sub">${esc(sub)}</span>` : ''}</div>
  <div class="bar-track"><div class="bar-fill ${scoreClass(pct)}" style="width:${Math.max(pct, 0.8).toFixed(1)}%"></div></div>
  <div class="bar-val ${scoreClass(pct)}">${pct.toFixed(0)}%</div></div>`;

function donut(pct, size = 132) {
  const r = size / 2 - 13, sw = 14, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="donut-bg" stroke-width="${sw}" fill="none"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="donut-fg ${scoreClass(pct)}" stroke-width="${sw}"
     fill="none" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"
     transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="round"/>
  <text x="50%" y="50%" class="donut-txt" text-anchor="middle" dy=".36em">${pct.toFixed(0)}%</text></svg>`;
}

function stacked(label, f, p, e) {
  const tot = Math.max(f + p + e, 1);
  return `<div class="st-row"><div class="st-lbl">${esc(label)}</div>
  <div class="st-bar"><div class="st-f" style="width:${(100 * f / tot).toFixed(2)}%"></div>
  <div class="st-p" style="width:${(100 * p / tot).toFixed(2)}%"></div>
  <div class="st-e" style="width:${(100 * e / tot).toFixed(2)}%"></div></div>
  <div class="st-n"><b>${f}</b> / ${f + p + e}</div></div>`;
}

const mark = ok => ok ? '<span class="mk mk-y">✓</span>' : '<span class="mk mk-n">—</span>';

export const CSS = `
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:10.5pt/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;
     color:#1c1e21;background:#f4f5f7}
.page{width:210mm;min-height:297mm;padding:15mm 14mm 18mm;margin:0 auto 8mm;background:#fff;
      box-shadow:0 1px 4px rgba(0,0,0,.12);position:relative}
@page{size:A4;margin:13mm}
@media print{body{background:#fff}.page{width:auto;min-height:0;margin:0;padding:0;box-shadow:none;
  page-break-after:always}.page:last-child{page-break-after:auto}#printbar{display:none!important}}
h1{font-size:25pt;margin:0 0 4pt;letter-spacing:-.4pt;font-weight:650}
h2{font-size:14.5pt;margin:0 0 9pt;padding-bottom:5pt;border-bottom:2px solid #e3e5e8;font-weight:640}
h3{font-size:11pt;margin:15pt 0 6pt;font-weight:640;color:#33383d}
p{margin:0 0 8pt}
.muted{color:#6b7280}.small{font-size:9pt}
.cover{display:flex;flex-direction:column;height:265mm}
.cover-top{border-left:5px solid #1c1e21;padding-left:12pt;margin-bottom:24pt}
.cover-sub{font-size:12.5pt;color:#6b7280;margin-top:2pt}
.cover-mid{display:flex;gap:32pt;align-items:center;margin:auto 0}
.kv{display:grid;grid-template-columns:auto 1fr;gap:5pt 16pt;font-size:10.5pt;margin:0}
.kv dt{color:#6b7280}
.kv dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.cover-foot{border-top:1px solid #e3e5e8;padding-top:9pt;font-size:8.2pt;color:#6b7280}
.donut-bg{stroke:#e8eaed}
.donut-txt{font-size:25px;font-weight:680;fill:#1c1e21}
.donut-fg.s-good{stroke:#2e6b3e}.donut-fg.s-ok{stroke:#7a7500}
.donut-fg.s-warn{stroke:#c77700}.donut-fg.s-bad{stroke:#b3261e}
.score-cap{font-size:9pt;color:#6b7280;margin-top:4pt;text-align:center}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8pt;margin:10pt 0 4pt}
.card{border:1px solid #e3e5e8;border-radius:5px;padding:9pt 10pt;background:#fbfbfc}
.card .n{font-size:19pt;font-weight:660;font-variant-numeric:tabular-nums;line-height:1.1}
.card .l{font-size:8.3pt;color:#6b7280;margin-top:1pt}
.card.c-fail .n{color:#b3261e}.card.c-pass .n{color:#2e6b3e}.card.c-excl .n{color:#6b7280}
table{width:100%;border-collapse:collapse;font-size:9.2pt}
th,td{text-align:left;padding:4.5pt 7pt;border-bottom:1px solid #eceef0;vertical-align:top}
th{font-size:8.2pt;text-transform:uppercase;letter-spacing:.4pt;color:#6b7280;font-weight:620}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
td.ctr,th.ctr{text-align:center}
tr.tot td{border-top:2px solid #d6d9dd;border-bottom:none;font-weight:650}
tr.risk td{background:#fdf4f3}
.bar-row{display:grid;grid-template-columns:150pt 1fr 34pt;gap:9pt;align-items:center;margin-bottom:7pt}
.bl-main{display:block;font-size:9.4pt;font-weight:560}
.bl-sub{display:block;font-size:7.6pt;color:#6b7280;line-height:1.3}
.bar-track{height:15pt;background:#eef0f2;border-radius:2px;overflow:hidden}
.bar-fill{height:100%;border-radius:2px}
.bar-fill.s-good{background:#2e6b3e}.bar-fill.s-ok{background:#7a7500}
.bar-fill.s-warn{background:#c77700}.bar-fill.s-bad{background:#b3261e}
.bar-val{font-size:10pt;font-weight:640;text-align:right;font-variant-numeric:tabular-nums}
.bar-val.s-good{color:#2e6b3e}.bar-val.s-ok{color:#7a7500}
.bar-val.s-warn{color:#c77700}.bar-val.s-bad{color:#b3261e}
.st-row{display:grid;grid-template-columns:88pt 1fr 62pt;gap:9pt;align-items:center;margin-bottom:5pt}
.st-lbl{font-size:9.2pt}
.st-bar{display:flex;height:13pt;border-radius:2px;overflow:hidden;background:#eef0f2}
.st-f{background:#b3261e}.st-p{background:#2e6b3e}.st-e{background:#c9ced4}
.st-n{font-size:9pt;text-align:right;font-variant-numeric:tabular-nums;color:#6b7280}
.st-n b{color:#b3261e}
.legend{display:flex;gap:14pt;font-size:8.2pt;color:#6b7280;margin:7pt 0 2pt}
.legend i{display:inline-block;width:8pt;height:8pt;border-radius:2px;margin-right:4pt;vertical-align:-.5pt}
.hz{margin-top:8pt}
.hz-row{display:grid;grid-template-columns:132pt 1fr 42pt 30pt;gap:8pt;align-items:center;margin-bottom:4.5pt}
.hz-lbl{font-size:8.8pt;line-height:1.2}
.hz-sec{display:block;font-size:7.2pt;color:#9aa0a6}
.hz-wrap{background:#f4f5f7;border-radius:2px}
.hz-bar{display:flex;height:12pt;border-radius:2px;overflow:hidden;min-width:3pt}
.hz-n{font-size:8.6pt;text-align:right;font-variant-numeric:tabular-nums;color:#9aa0a6}
.hz-n b{color:#b3261e;font-size:9.4pt}
.hz-p{font-size:8.4pt;text-align:right;font-weight:640;font-variant-numeric:tabular-nums}
.hz-p.s-good{color:#2e6b3e}.hz-p.s-ok{color:#7a7500}
.hz-p.s-warn{color:#c77700}.hz-p.s-bad{color:#b3261e}
.chips{display:flex;flex-wrap:wrap;gap:4pt;margin-top:5pt}
.chip{font-size:8pt;padding:2pt 6pt;border-radius:10pt;background:#eef4ef;color:#1f5130;border:1px solid #cfe3d5}
.chip b{font-variant-numeric:tabular-nums}
.miss{display:inline-block;font-size:7.8pt;padding:1.5pt 5pt;border-radius:3px;margin:0 3pt 2pt 0;
      background:#fdecea;color:#8c1d18;border:1px solid #f4c7c3;white-space:nowrap}
.badge{display:inline-block;padding:1.5pt 6pt;border-radius:3px;font-size:8pt;font-weight:620;white-space:nowrap}
.b-Critical{background:#fdecea;color:#8c1d18;border:1px solid #f4c7c3}
.b-High{background:#fdefe3;color:#8a3f04;border:1px solid #f5d3b0}
.b-Warning{background:#fdf6e3;color:#6b4e00;border:1px solid #eedfae}
.b-Informational{background:#eef2f8;color:#28456e;border:1px solid #ccd8ea}
.b-yes{background:#e9f3ec;color:#1f5130;border:1px solid #bfdcc8}
.b-no{background:#fdecea;color:#8c1d18;border:1px solid #f4c7c3}
.mk{font-weight:700;font-size:10pt}
.mk-y{color:#2e6b3e}.mk-n{color:#c2c7cd}
.act{font-size:8.2pt;padding:1pt 5pt;border-radius:3px;background:#f2f3f5;color:#4b5158}
.act-allow{background:#eef2f8;color:#28456e}
.finding{border:1px solid #e3e5e8;border-left:3px solid #c9ced4;border-radius:4px;
         padding:9pt 11pt;margin-bottom:8pt;page-break-inside:avoid;background:#fff}
.finding.f-Critical{border-left-color:#b3261e}
.finding.f-High{border-left-color:#c77700}
.finding.f-Warning{border-left-color:#a98a00}
.finding.f-Informational{border-left-color:#5b7fb0}
.f-head{display:flex;gap:7pt;align-items:baseline;margin-bottom:4pt}
.f-name{font-weight:620;font-size:9.8pt;flex:1}
.f-id{font-size:8pt;color:#6b7280;font-variant-numeric:tabular-nums;white-space:nowrap}
.f-meta{font-size:8.3pt;color:#6b7280;margin-bottom:5pt}
.f-msg{font-size:8.8pt;color:#33383d;margin-top:4pt}
.f-lbl{font-size:7.8pt;text-transform:uppercase;letter-spacing:.4pt;color:#6b7280;
       font-weight:620;margin-top:6pt;margin-bottom:2pt}
.objs{font-size:8.4pt}
.objs code{background:#f2f3f5;padding:.5pt 3.5pt;border-radius:2.5px;font-size:8pt;
           font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.note{background:#f7f8f9;border-left:3px solid #d6d9dd;padding:7pt 10pt;font-size:8.6pt;
      color:#4b5158;margin:8pt 0}
.foot{position:absolute;bottom:8mm;left:14mm;right:14mm;border-top:1px solid #eceef0;
      padding-top:4pt;font-size:7.4pt;color:#9aa0a6;display:flex;justify-content:space-between}
@media print{.foot{position:fixed;bottom:3mm;left:0;right:0}}
#printbar{position:fixed;top:14px;right:14px;z-index:99;display:flex;gap:8px}
#printbar button{padding:9px 16px;border:0;border-radius:7px;background:#1c1e21;color:#fff;
  font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)}
`;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * @param {object} report  ham BPA JSON (+ opsiyonel _device_metadata)
 * @param {'tr'|'en'} lang
 * @returns {string} tam HTML belgesi
 */
export function renderReport(report, lang = 'tr') {
  const T = STR[lang] || STR.tr;
  const rows = flatten(report);
  const info = report.information || {};
  const dm = report._device_metadata || {};

  const passed = rows.filter(r => r.status === 'Passed').length;
  const failed = rows.filter(r => r.status === 'Failed').length;
  const excl = rows.filter(r => r.status === 'Excluded').length;
  const score = (passed + failed) ? 100 * passed / (passed + failed) : 0;

  const host = dm.hostname || info.device_hostname || '—';
  const gen = new Date().toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const foot = `<div class="foot"><span>${esc(T.title)} — ${esc(host)}</span><span>${esc(gen)}</span></div>`;
  const LEG = `<div class="legend"><span><i style="background:#b3261e"></i>${esc(T.failed)}</span>
    <span><i style="background:#2e6b3e"></i>${esc(T.passed)}</span>
    <span><i style="background:#c9ced4"></i>${esc(T.excluded)}</span></div>`;
  const P = [];

  // ---- Kapak ----
  const meta = [[T.device, host], [T.model, dm.model], [T.serial, dm.serial],
    [T.panos, dm['sw-version'] || info.PanOS_version], [T.ip, info.device_ip_address],
    [T.vsys, (info.vsys || []).join(', ')], [T.generated, gen]];
  const kv = meta.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  P.push(`<section class="page"><div class="cover">
    <div class="cover-top"><h1>${esc(T.title)}</h1><div class="cover-sub">${esc(T.subtitle)}</div></div>
    <div class="cover-mid"><div>${donut(score, 172)}<div class="score-cap">${esc(T.score)}</div></div>
      <dl class="kv">${kv}</dl></div>
    <div class="cover-foot">${esc(T.appendix_body)}</div></div></section>`);

  // ---- Yonetici ozeti ----
  const sev = {};
  for (const r of rows) {
    sev[r.severity] = sev[r.severity] || {};
    sev[r.severity][r.status] = (sev[r.severity][r.status] || 0) + 1;
  }
  const dist = SEV_ORDER.filter(s => sev[s]).map(s =>
    stacked(T['sev_' + s], sev[s].Failed || 0, sev[s].Passed || 0, sev[s].Excluded || 0)).join('');
  const secDist = SEC_ORDER.map(s => {
    const sub = rows.filter(r => r.section === s);
    if (!sub.length) return '';
    return stacked(T['sec_' + s],
      sub.filter(r => r.status === 'Failed').length,
      sub.filter(r => r.status === 'Passed').length,
      sub.filter(r => r.status === 'Excluded').length);
  }).join('');
  const rs = info.security_rule_stats || {};
  const rsHtml = Object.keys(rs).length ? `<h3>${esc(T.rulestats)}</h3><div class="cards">
    <div class="card"><div class="n">${rs.total || 0}</div><div class="l">${esc(T.rs_total)}</div></div>
    <div class="card"><div class="n">${rs.allow || 0}</div><div class="l">${esc(T.rs_allow)}</div></div>
    <div class="card"><div class="n">${rs.deny || 0}</div><div class="l">${esc(T.rs_deny)}</div></div>
    <div class="card"><div class="n">${rs.disabled || 0}</div><div class="l">${esc(T.rs_disabled)}</div></div></div>` : '';

  /**
   * Ham uygunsuzluk sayisi ile FARKLI BULGU sayisi cok ayrisir ve ham sayi
   * yaniltir. Olculen gercek cihaz (PA-3440): 2531 uygunsuzluk ama yalnizca
   * 86 farkli bulgu — tek bir kontrol (#208) 1827 kurali etkiliyor.
   * "2531 uygunsuzluk" felaket tablosu cizer; dogru cumle "86 farkli sorun,
   * en buyugu 1827 kurali etkiliyor"dur.
   *
   * Olculen dort cihazda farkli bulgu sayisi 79-112 arasinda sabit kaldi,
   * ham sayi ise 152'den 2531'e cikti.
   */
  const failRows = rows.filter(r => r.status === 'Failed');
  const byId = new Map();
  for (const r of failRows) byId.set(r.id, (byId.get(r.id) || 0) + 1);
  const distinctN = byId.size;
  const distinctCrit = new Set(failRows.filter(r => r.severity === 'Critical').map(r => r.id)).size;
  const counts = [...byId.values()].sort((a, b) => b - a);
  const top1 = counts[0] || 0;
  const top3 = counts.slice(0, 3).reduce((a, b) => a + b, 0);
  const top3pct = failed ? Math.round(100 * top3 / failed) : 0;

  // Carpiklik ancak anlamli oldugunda soylenir
  const skew = (top3pct >= 50 && distinctN > 3)
    ? `<div class="note">${esc(T.skew_note.replace('{pct}', '%' + top3pct)
        .replace('{k}', Math.min(3, distinctN)).replace('{n}', top1))}</div>` : '';

  P.push(`<section class="page"><h2>${esc(T.exec)}</h2><div class="cards">
    <div class="card c-fail"><div class="n">${distinctN}</div><div class="l">${esc(T.distinct)}</div></div>
    <div class="card c-fail"><div class="n">${distinctCrit}</div><div class="l">${esc(T.distinct_crit)}</div></div>
    <div class="card"><div class="n">${failed}</div><div class="l">${esc(T.instances)}</div></div>
    <div class="card c-pass"><div class="n">${passed}</div><div class="l">${esc(T.passed)}</div></div></div>
    <div class="note"><strong>${esc(T.score)}: ${score.toFixed(1)}%</strong> — ${esc(T.score_note)}</div>
    ${skew}
    <h3>${esc(T.distribution)}</h3>${LEG}${dist}
    <h3>${esc(T.sections)}</h3>${secDist}${rsHtml}${foot}</section>`);

  // ---- Kullanim oranlari + decryption ----
  const ad = computeAdoption(report);
  if (ad) {
    const dec = computeDecryption(report);
    const bars = Object.entries(ad).map(([k, v]) =>
      bar(v.pct, T[k], `${v.n}/${v.d} · ${T[k + '_d']}`)).join('');
    const drows = Object.entries(dec).map(([k, v]) =>
      `<tr><td>${esc(T[k])}</td><td><span class="badge b-${v ? 'yes' : 'no'}">${esc(v ? T.configured : T.notconfigured)}</span></td></tr>`).join('');
    P.push(`<section class="page"><h2>${esc(T.adoption)}</h2>
      <div class="note">${esc(T.adoption_note)}</div>${bars}
      <h3>${esc(T.decryption)}</h3><div class="note">${esc(T.dec_note)}</div>
      <table><tbody>${drows}</tbody></table>${foot}</section>`);
  }

  // ---- Uygunsuzluk yogunlugu ----
  const cts = ctStats(report);
  const dirty = cts.filter(c => c.f).sort((a, b) => b.f - a.f || b.tot - a.tot);
  const clean = cts.filter(c => !c.f).sort((a, b) => b.tot - a.tot);
  if (dirty.length) {
    const mx = Math.max(...dirty.map(c => c.tot)) || 1;
    const hrows = dirty.map(c => {
      const comp = (c.p + c.f) ? 100 * c.p / (c.p + c.f) : 0;
      return `<div class="hz-row">
        <div class="hz-lbl">${esc(prettyCt(c.ct, lang))}<span class="hz-sec">${esc(T['sec_' + c.sec])}</span></div>
        <div class="hz-wrap"><div class="hz-bar" style="width:${(100 * c.tot / mx).toFixed(1)}%">
          <div class="st-f" style="width:${(100 * c.f / c.tot).toFixed(2)}%"></div>
          <div class="st-p" style="width:${(100 * c.p / c.tot).toFixed(2)}%"></div>
          <div class="st-e" style="width:${(100 * c.e / c.tot).toFixed(2)}%"></div></div></div>
        <div class="hz-n"><b>${c.f}</b><span class="muted">/${c.tot}</span></div>
        <div class="hz-p ${scoreClass(comp)}">${comp.toFixed(0)}%</div></div>`;
    }).join('');
    const cleanHtml = clean.length ? `<h3>${esc(T.heat_clean)}</h3><div class="chips">${
      clean.map(c => `<span class="chip">${esc(prettyCt(c.ct, lang))} <b>${c.tot}</b></span>`).join(' ')}</div>` : '';
    P.push(`<section class="page"><h2>${esc(T.heat)}</h2><div class="note">${esc(T.heat_note)}</div>
      ${LEG}<div class="hz">${hrows}</div>${cleanHtml}${foot}</section>`);
  }

  // ---- Kural kapsam analizi (olcege gore) ----
  const flags = ruleGaps(report);
  if (flags.length) {
    const nrisk = flags.filter(f => f.action === 'allow' && !f.prof && !f.disabled).length;
    const riskNote = nrisk ? `<div class="note"><strong>⚠ ${nrisk}</strong> — ${esc(T.m_risk)}</div>` : '';
    const MISS_LBL = { app: T.m_app, user: T.m_user, svc: T.m_svc, prof: T.m_prof, log: T.m_log };
    const head = `<th class="ctr">${esc(T.m_app)}</th><th class="ctr">${esc(T.m_user)}</th>
      <th class="ctr">${esc(T.m_svc)}</th><th class="ctr">${esc(T.m_prof)}</th><th class="ctr">${esc(T.m_log)}</th>`;
    const row = (f, withRisk = false) => {
      const risky = f.action === 'allow' && !f.prof && !f.disabled;
      const rk = withRisk ? `<td class="num"><b style="color:#b3261e">${f.risk}</b></td>` : '';
      return `<tr class="${risky ? 'risk' : ''}"><td>${esc(f.name)}${risky ? ' ⚠' : ''}</td>
        <td><span class="act act-${esc(f.action)}">${esc(f.action)}</span></td>${rk}
        <td class="ctr">${mark(f.app)}</td><td class="ctr">${mark(f.user)}</td>
        <td class="ctr">${mark(f.svc)}</td><td class="ctr">${mark(f.prof)}</td>
        <td class="ctr">${mark(f.log)}</td></tr>`;
    };

    if (flags.length <= MATRIX_FULL_LIMIT) {
      P.push(`<section class="page"><h2>${esc(T.matrix)}</h2>
        <div class="note">${esc(T.matrix_note)}</div>${riskNote}
        <table><thead><tr><th>${esc(T.m_rule)}</th><th>${esc(T.m_action)}</th>${head}</tr></thead>
        <tbody>${flags.map(f => row(f)).join('')}</tbody></table>${foot}</section>`);
    } else {
      const pats = gapPatterns(flags);
      const shown = pats.slice(0, PATTERN_LIMIT), rest = pats.slice(PATTERN_LIMIT);
      let ptrs = shown.map(p => {
        const chips = p.miss.map(m => `<span class="miss">${esc(MISS_LBL[m])}</span>`).join('')
          || `<span class="chip">${esc(T.p_none)}</span>`;
        return `<tr class="${p.risk >= 3 ? 'risk' : ''}"><td>${chips}</td>
          <td><span class="act act-${esc(p.action)}">${esc(p.action)}</span></td>
          <td class="num"><b>${p.n}</b></td>
          <td class="small muted">${esc(p.examples.join(', '))}</td></tr>`;
      }).join('');
      if (rest.length) ptrs += `<tr><td class="muted small" colspan="2">+${rest.length} ${esc(T.more)}</td>
        <td class="num muted">${rest.reduce((a, p) => a + p.n, 0)}</td><td></td></tr>`;

      const scored = flags.filter(f => f.risk > 0).sort((a, b) => b.risk - a.risk || a.name.localeCompare(b.name));
      const worst = scored.slice(0, WORST_LIMIT);
      const nmore = scored.length - worst.length;
      const wmore = nmore > 0 ? `<tr><td class="muted small" colspan="8">+${nmore} ${esc(T.more)}</td></tr>` : '';

      P.push(`<section class="page"><h2>${esc(T.patterns)}</h2>
        <div class="note">${esc(T.scale_note.replace('{n}', flags.length).replace('{k}', WORST_LIMIT))}</div>
        ${riskNote}<div class="note">${esc(T.patterns_note)}</div>
        <table><thead><tr><th>${esc(T.p_missing)}</th><th>${esc(T.m_action)}</th>
        <th class="num">${esc(T.p_count)}</th><th>${esc(T.p_examples)}</th></tr></thead>
        <tbody>${ptrs}</tbody></table>${foot}</section>`);
      P.push(`<section class="page"><h2>${esc(T.worst)}</h2><div class="note">${esc(T.worst_note)}</div>
        <table><thead><tr><th>${esc(T.m_rule)}</th><th>${esc(T.m_action)}</th>
        <th class="num">${esc(T.w_risk)}</th>${head}</tr></thead>
        <tbody>${worst.map(f => row(f, true)).join('')}${wmore}</tbody></table>${foot}</section>`);
    }
  }

  // ---- Bolge durusu + profil envanteri ----
  const zones = zonePosture(report), inv = profileInventory(report, lang);
  if (zones.length || inv.length) {
    let blocks = '';
    if (zones.length) {
      const zs = [...zones].sort((a, b) => (a.prot ? 1 : 0) - (b.prot ? 1 : 0) || a.name.localeCompare(b.name));
      const zshow = zs.slice(0, ZONE_LIMIT), zrest = zs.length - zshow.length;
      let zt = zshow.map(z => `<tr><td>${esc(z.name)}</td>
        <td><span class="badge b-${z.prot ? 'yes' : 'no'}">${esc(z.prot || T.no)}</span></td>
        <td class="ctr">${mark(z.pbp)}</td><td class="ctr">${mark(z.uid)}</td>
        <td>${esc(z.log || '—')}</td></tr>`).join('');
      if (zrest > 0) zt += `<tr><td class="muted small" colspan="5">+${zrest} ${esc(T.more)}</td></tr>`;
      blocks += `<h2>${esc(T.zones)}</h2><div class="note">${esc(T.zones_note)}</div>
        <table><thead><tr><th>${esc(T.z_name)}</th><th>${esc(T.z_prot)}</th>
        <th class="ctr">${esc(T.z_pbp)}</th><th class="ctr">${esc(T.z_uid)}</th>
        <th>${esc(T.z_log)}</th></tr></thead><tbody>${zt}</tbody></table>`;
    }
    if (inv.length) {
      const it = inv.map(i => {
        const shown = i.names.slice(0, PROFILE_NAME_LIMIT);
        let names = shown.map(n => `<code>${esc(n)}</code>`).join(' ');
        if (i.names.length > PROFILE_NAME_LIMIT)
          names += ` <span class="muted">+${i.names.length - PROFILE_NAME_LIMIT} ${esc(T.more)}</span>`;
        const fail = i.fail ? `<b style="color:#b3261e">${i.fail}</b>` : '0';
        return `<tr><td>${esc(i.type)}</td><td class="small">${names}</td>
          <td class="num">${i.count}</td><td class="num">${fail}</td></tr>`;
      }).join('');
      blocks += `<h3>${esc(T.inventory)}</h3><div class="note">${esc(T.inventory_note)}</div>
        <table><thead><tr><th>${esc(T.i_type)}</th><th>${esc(T.i_names)}</th>
        <th class="num">${esc(T.i_count)}</th><th class="num">${esc(T.i_fail)}</th></tr></thead>
        <tbody>${it}</tbody></table>`;
    }
    P.push(`<section class="page">${blocks}${foot}</section>`);
  }

  // ---- Bulgular ----
  const groups = new Map();
  for (const r of rows) {
    if (r.status !== 'Failed') continue;
    if (!groups.has(r.id)) groups.set(r.id, { row: r, objs: [] });
    groups.get(r.id).objs.push(r);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const sa = SEV_ORDER.indexOf(a.row.severity), sb = SEV_ORDER.indexOf(b.row.severity);
    return (sa < 0 ? 9 : sa) - (sb < 0 ? 9 : sb) || b.objs.length - a.objs.length || (a.row.id || 0) - (b.row.id || 0);
  });

  const findingHtml = (g, showMsg = true) => {
    const r = g.row;
    const names = [...new Set(g.objs.map(o => o.object))];
    let oh = names.slice(0, 24).map(n => `<code>${esc(n)}</code>`).join(' ');
    if (names.length > 24) oh += ` <span class="muted">+${names.length - 24}</span>`;
    const ff = Object.assign({}, ...g.objs.map(o => o.failedFields || {}));
    const ffKeys = Object.keys(ff).slice(0, 20);
    const ffh = ffKeys.length ? `<div class="f-lbl">${esc(T.failedfields)}</div>
      <div class="objs">${ffKeys.map(k => `<code>${esc(k)}</code>`).join(' ')}</div>` : '';
    const msg = (showMsg && r.message)
      ? `<div class="f-lbl">${esc(T.remediation)}</div><div class="f-msg">${esc(r.message)}</div>` : '';
    return `<div class="finding f-${r.severity}">
      <div class="f-head"><span class="badge b-${r.severity}">${esc(T['sev_' + r.severity])}</span>
        <span class="f-name">${esc(r.name)}</span><span class="f-id">#${esc(r.id)}</span></div>
      <div class="f-meta">${esc(T['sec_' + r.section] || r.section)} › ${esc(r.ctype)} ·
        ${g.objs.length} ${esc(T.occurrences)}</div>
      <div class="f-lbl">${esc(T.affected)}</div><div class="objs">${oh}</div>${ffh}${msg}</div>`;
  };

  const top = ordered.filter(g => g.row.severity === 'Critical').slice(0, 6);
  if (top.length) {
    P.push(`<section class="page"><h2>${esc(T.top)}</h2><div class="note">${esc(T.top_note)}</div>
      ${top.map(g => findingHtml(g, false)).join('')}${foot}</section>`);
  }
  for (const s of SEC_ORDER) {
    const gs = ordered.filter(g => g.row.section === s);
    const body = gs.length ? gs.map(g => findingHtml(g)).join('')
      : `<p class="muted">${esc(T.nofindings)}</p>`;
    P.push(`<section class="page"><h2>${esc(T.findings)} — ${esc(T['sec_' + s])}</h2>
      <div class="note">${esc(T.findings_note)}</div>${body}${foot}</section>`);
  }

  P.push(`<section class="page"><h2>${esc(T.appendix)}</h2><p>${esc(T.appendix_body)}</p>
    <p class="small muted">${esc(gen)} · ${esc(host)} · ${esc(dm.model || '')} ·
    PAN-OS ${esc(dm['sw-version'] || info.PanOS_version || '—')}</p>${foot}</section>`);

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(T.title)} — ${esc(host)}</title><style>${CSS}</style></head><body>
<div id="printbar"><button onclick="window.print()">${esc(T.print)}</button></div>
${P.join('')}</body></html>`;
}

/** Raporu yeni sekmede acar. Kullanici Cmd+P ile PDF olarak kaydeder. */
export function openReport(report, lang = 'tr') {
  const html = renderReport(report, lang);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  // Blob URL sekme kapanana kadar yasamali; erken revoke edilirse sayfa bosalir
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return w;
}
