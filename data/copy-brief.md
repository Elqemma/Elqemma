# Copy brief — «القمة في القسم اللفظي»

Final Arabic copy for `teacher.html` and `about.html`, plus the shared `<head>` strings
and the `index.html` hero. Arabic blocks are finished prose: paste them verbatim.
Everything in English — headings, `NOTE:` lines — is scaffolding for whoever marks this
up, and must never reach a page.

Why a copy file at all: three agents write three pages, and the teacher's facts are few
and easy to embellish. Keeping every visitor-facing sentence in one reviewed file is how
the pages end up agreeing with each other and staying inside what we actually know.

---

## 0. House rules for the markup

- **Facts are closed.** Everything below comes from the teacher's own brief and from
  `assets/data/exams.json`. If a sentence you want is not here, we do not know it — do not
  write it. No superlatives, no guarantees, no pass rates, no student counts, no prices,
  no «معتمد من قياس», no social accounts, no address.
- **Nothing is called free.** The teacher asked (2026-09-24) that no page say «مجاني»,
  «مجانًا» or anything that means it («بلا مقابل», «بلا اشتراك»). «بلا تسجيل» is fine — it is
  about accounts, not price. `tools/test-seo.mjs` fails if the word comes back, in the copy,
  the metadata, the manifest or the share card.
- **His rights close every page.** The footer's last line reserves them (section 5).
- **The source of «الأكثر تكرارًا» is never named.** The teacher asked (2026-09-24): no page,
  no generated file and nothing else in this repository — it is published with the site —
  names the compilation the shortlist is matched against, or says whose it is. The copy
  says «يتكرّر ورودها أكثر من غيرها في التجميعات المتداولة» and «ليست ترتيبًا شخصيًا», and
  stops there. `tools/test-seo.mjs` fails if the name comes back.
- **Neither secret is ever published.** The form's own code: copy says «رمز دخول تأخذه من
  الأستاذ» and stops there. The site password: «كلمة مرور تُؤخذ من الأستاذ», and stops there.
  Section 10 has the gate's words.
- **«الأكثر تكرارًا» is hidden unless the teacher shows it** (asked 2026-09-24). He switches it
  from `lock-admin.html`; it ships off. With it off, no page, no FAQ, no JSON-LD and no
  `llms.txt` line may mention it — not even in hidden markup, because crawlers read the
  source. Every word the site says about it (label, blurb, the about page's section) lives in
  `tools/build-data.mjs` → `assets/data/shortlist.json`, and reaches a page only while the
  switch is on. Write new copy for it there, never into a page. `tools/test-seo.mjs` fails if
  a page or `llms.txt` carries a word of it.
- **Digits** stay Western (`301`, `3657`, `225`) and get `class="tnum"`, so they keep lining
  figures inside RTL text. The slogan «القمة — طريقك نحو الـ ١٠٠» is the one exception: it is a
  brand string and keeps its Arabic-Indic ١٠٠.
- **The phone** renders as `<bdi dir="ltr" class="tnum">+966 50 700 8364</bdi>`, because RTL
  reordering scrambles a bare `+966…`. Links: `tel:+966507008364`, `https://wa.me/966507008364`.
- **Latin runs** (`Google Forms`) get `<span dir="ltr">` for the same reason.
- **Number agreement** here is deliberate: «301 نموذج» (a compound of مائة, so its تمييز is
  singular), «3657 سؤالًا», «225 قسمًا», «54 قسمًا جديدًا», «22 قسمًا». Do not "fix" them.
- **The name.** Full: «عبد الرحمن سيد منصور». Short, after first mention: «الأستاذ عبد الرحمن».
  Never «عبدالرحمن» as one word — the space is part of the name, and the search engines index
  the spaced form.
- Strings not in this file (empty states, toasts, aria labels the page invents) belong to the
  page author, but keep the register: short sentences, second person, no hype.

### 0.1 WhatsApp prefilled messages

Plain text first, then the exact `encodeURIComponent` output to paste after `?text=`.

General enquiry — «السلام عليكم أستاذ عبد الرحمن، أرغب في الاستفسار عن القسم اللفظي.»

```
%D8%A7%D9%84%D8%B3%D9%84%D8%A7%D9%85%20%D8%B9%D9%84%D9%8A%D9%83%D9%85%20%D8%A3%D8%B3%D8%AA%D8%A7%D8%B0%20%D8%B9%D8%A8%D8%AF%20%D8%A7%D9%84%D8%B1%D8%AD%D9%85%D9%86%D8%8C%20%D8%A3%D8%B1%D8%BA%D8%A8%20%D9%81%D9%8A%20%D8%A7%D9%84%D8%A7%D8%B3%D8%AA%D9%81%D8%B3%D8%A7%D8%B1%20%D8%B9%D9%86%20%D8%A7%D9%84%D9%82%D8%B3%D9%85%20%D8%A7%D9%84%D9%84%D9%81%D8%B8%D9%8A.
```

Asking for the code — «السلام عليكم أستاذ عبد الرحمن، أريد رمز الدخول للنماذج.»

```
%D8%A7%D9%84%D8%B3%D9%84%D8%A7%D9%85%20%D8%B9%D9%84%D9%8A%D9%83%D9%85%20%D8%A3%D8%B3%D8%AA%D8%A7%D8%B0%20%D8%B9%D8%A8%D8%AF%20%D8%A7%D9%84%D8%B1%D8%AD%D9%85%D9%86%D8%8C%20%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%B1%D9%85%D8%B2%20%D8%A7%D9%84%D8%AF%D8%AE%D9%88%D9%84%20%D9%84%D9%84%D9%86%D9%85%D8%A7%D8%B0%D8%AC.
```

---

## 1. Shared `<head>` strings

Counts are characters, measured. `<title>` ≤ 60, `meta description` 150–160. The OG strings
are shorter on purpose: a share card truncates earlier, and it arrives with no page around it,
which is also why each OG title repeats the brand.

### 1.1 index.html

- **title** (56) — `القسم اللفظي: 301 نموذج قدرات — الأستاذ عبد الرحمن منصور`
- **description** (198) — `301 نموذج إلكتروني تُحدَّث أولًا بأول لتدريب القسم اللفظي في اختبار القدرات، إعداد الأستاذ عبد الرحمن سيد منصور — ماجستير اللغة العربية. ابحث بالاسم أو بالرقم، وافتح النموذج بكلمة المرور من الأستاذ.`
- **og:title** (55) — `القسم اللفظي مع الأستاذ عبد الرحمن منصور — مدرب القدرات`
- **og:description** (163) — `301 نموذج إلكتروني تُحدَّث أولًا بأول في القسم اللفظي، إعداد الأستاذ عبد الرحمن سيد منصور — ماجستير اللغة العربية ومدرب القدرات. للتواصل: واتساب ‎+966 50 700 8364.`
- **og:site_name** — `القمة في القسم اللفظي`
- **og:image:alt** — `القمة في القسم اللفظي — الأستاذ عبد الرحمن سيد منصور، مدرب القدرات`

### 1.2 teacher.html

- **title** (50) — `عبد الرحمن سيد منصور — مدرب القدرات (القسم اللفظي)`
- **description** (194) — `الأستاذ عبد الرحمن سيد منصور، ماجستير اللغة العربية ومدرب القدرات في القسم اللفظي، بخبرة خمسة عشر عامًا في القدرات والمناهج السعودية. شروحات مبسّطة واستراتيجيات حل و301 نموذج تُحدَّث أولًا بأول.`
- **og:title** (43) — `الأستاذ عبد الرحمن سيد منصور — مدرب القدرات`
- **og:description** (130) — `مدرب القدرات في القسم اللفظي، وماجستير اللغة العربية، وخبرة خمسة عشر عامًا في القدرات والمناهج السعودية. واتساب ‎+966 50 700 8364.`
- **og:image:alt** — `الأستاذ عبد الرحمن سيد منصور — مدرب القدرات، القسم اللفظي`
- **meta author** — `عبد الرحمن سيد منصور`

### 1.3 about.html

- **title** (46) — `عن منصة القمة في القسم اللفظي وطريقة استخدامها`
- **description** (157) — `كيف تستخدم نماذج القسم اللفظي: ابحث بالاسم أو بالرقم، افتح النموذج، وتابع تقدّمك المحفوظ على جهازك وحده. وأسئلة شائعة عن رمز الدخول والدرجات وخصوصية بياناتك.`
- **og:title** (49) — `عن منصة «القمة في القسم اللفظي» — طريقة الاستخدام`
- **og:description** (133) — `كيف تستخدم 301 نموذج تُحدَّث أولًا بأول في القسم اللفظي: البحث بالاسم أو بالرقم، رمز الدخول، ومتابعة التقدّم المحفوظة على جهازك وحده.`

---

## 2. index.html — hero

- **eyebrow** — `القمة في القسم اللفظي · قدراتك تحت السيطرة`
- **H1** — `القمة في القسم اللفظي مع الأستاذ عبد الرحمن منصور`

  NOTE: wrap «الأستاذ عبد الرحمن منصور» in the `<em>` the hero style expects. The H1 carries
  brand + person + subject together on purpose: that pairing is the entity we want Google and
  the AI assistants to attach to this site.

- **subtitle / lead** — `ابحث عن النموذج باسمه أو برقمه وابدأ فورًا. لا يحتاج الموقع تسجيلًا، ويطلب كل نموذج رمز دخول تأخذه من الأستاذ.`
- **byline** (beside the portrait) — `إعداد الأستاذ عبد الرحمن سيد منصور — مدرب القدرات · ماجستير اللغة العربية`
  («الأستاذ عبد الرحمن سيد منصور» links to `teacher.html`. No «و» before «ماجستير» — the
  teacher asked for the dot, 2026-09-24.)
- **hero photo caption** — `الأستاذ / عبد الرحمن منصور` · `مدرب القدرات · ماجستير اللغة العربية`
- **search placeholder** — `ابحث باسم القسم أو برقمه`
- **search hint** — `مثال: الزلازل، أو 47`
- **stat labels** — `قسم · محدَّثة أولًا بأول` · `سؤالًا` · `آخر تحديث`

  NOTE: the first figure counts sections, «301 قسم», because the teacher's own file does
  («الأقسام 1 إلى 301»). «قسم» is `data-unit="section"`, so it follows the count like the
  other units (305 → «أقسام», 320 → «قسمًا»); the dot keeps «محدَّثة» correct for all three.

  NOTE: «محدَّثة أولًا بأول» goes wherever the site states its count of forms (the user
  asked, 2026-09-24). Two forms, so the Arabic stays right whatever the count becomes:
  - **after a dot, as a label** — `محدَّثة أولًا بأول`: this hero stat, the count above the
    grid (`301 نموذج · محدَّثة أولًا بأول`, unfiltered list only; on phones ≤380px and at
    900–1099px it drops under the figure so the sticky row keeps one line of controls), and
    the share card (`tools/og-cover.template.html`, a second line under «نموذج»).
  - **inside a sentence, as a verb** — `تُحدَّث أولًا بأول`: the meta and OG descriptions,
    the JSON-LD descriptions on index.html, the teacher panel (3.5), the about lede, the
    manifest and llms.txt. A feminine verb after «301 نموذج» is the usual agreement for a
    non-human plural; the adjective «محدَّثة» would not agree with the singular تمييز.
  Deliberately left without it: the index `<title>` (it would pass 60 characters), the FAQ
  answers that mention 301 in passing, and every «من 301» that is a denominator — the
  pager line, the progress bar, «134 قسمًا من 301» — or a range end («280–301»).

  NOTE: the third stat reads `meta.generated` (2026-09-18 → «18 سبتمبر 2026»). A fourth,
  «134 الأكثر تكرارًا», is built by `app.js` in second place only while the teacher has the
  shortlist switched on; the markup never carries it (see section 0).

- **slogan strip / footer tagline** — `القمة — طريقك نحو الـ ١٠٠`

---

## 3. teacher.html

### 3.1 Head of page

- **breadcrumb** — `الرئيسية` › `الأستاذ`
- **eyebrow** — `مدرب القدرات · القسم اللفظي`
- **H1** — `الأستاذ عبد الرحمن سيد منصور — مدرب القدرات`
- **role line** (under the H1) — `ماجستير اللغة العربية · القسم اللفظي من اختبار القدرات العامة · خمسة عشر عامًا خبرة`
- **lead paragraph**

الأستاذ **عبد الرحمن سيد منصور** مدرب قدرات متخصّص في **القسم اللفظي**، وماجستير في اللغة
العربية، وخبرته خمسة عشر عامًا في القدرات والمناهج السعودية. يدرّب الطلاب والطالبات على
مهارات اللفظي بمحتوى مبسّط وخطوات واضحة، ويقدّم نماذجه التدريبية على هذه المنصة.

- **primary CTA** — `راسل الأستاذ على واتساب`
- **secondary CTA** — `تصفّح النماذج`
- **portrait caption** — `الأستاذ / عبد الرحمن سيد منصور · مدرب القدرات`
- **portrait alt** — `الأستاذ عبد الرحمن سيد منصور، مدرب القدرات في القسم اللفظي`

### 3.2 نبذة — heading: `نبذة عن الأستاذ عبد الرحمن`

خمسة عشر عامًا في القدرات والمناهج السعودية: متابعة لمستوى الطلاب والطالبات، وتحليل لأنواع
الأسئلة كما تتغيّر من دورة إلى أخرى، وتدريب متصل على القسم اللفظي من اختبار القدرات العامة.
من هذه المتابعة يبني الأستاذ عبد الرحمن محتواه.

واهتمامه منصبّ على المهارة نفسها: أن يفهم الطالب المهارات الأساسية في اللفظي، لا أن يحفظ
إجابات. ولذلك يأتي المحتوى مبسّطًا واضحًا عمليًا — يُقرأ ثم يُطبَّق مباشرة على الأسئلة.

وما يقدّمه ثلاثة أشياء متكاملة: شروحات للمهارات، ونماذج تدريبية يحلّها الطالب بنفسه،
واستراتيجيات حل ونصائح مبنية على تحليل أنواع الأسئلة. وهدفه من ذلك واحد: أن تكون قدراتك
**تحت السيطرة** — خطوات واضحة، ودعم مستمر، وسعي للوصول إلى أعلى الدرجات.

- **pull quote** (optional aside) — `قدراتك تحت السيطرة` · caption: `الهدف الذي يعمل عليه مع طلابه`

### 3.3 الخبرة والتخصص — heading: `الخبرة والتخصص`

Five cards, each a title and one factual line. Icon choice is the page author's.

| # | title | line |
|---|-------|------|
| 1 | `ماجستير اللغة العربية` | `التخصص الذي يقوم عليه شرح اللفظي.` |
| 2 | `مدرب القدرات` | `القسم اللفظي من اختبار القدرات العامة.` |
| 3 | `خمسة عشر عامًا` | `خبرة في القدرات والمناهج السعودية.` |
| 4 | `طلاب وطالبات` | `المحتوى موجَّه للطلاب والطالبات معًا.` |
| 5 | `301 نموذج تدريبي` | `على هذه المنصة، بمجموع 3657 سؤالًا.` |

### 3.4 كيف يساعدك — heading: `كيف يساعدك الأستاذ عبد الرحمن`

1. **شرح مبسّط للمهارات** — كل مهارة في القسم اللفظي مشروحة بلغة واضحة وخطوات قصيرة، تبدأ من الأساس لا من المستوى المتقدّم.
2. **نماذج تدريبية مصحّحة** — 301 نموذج تحلّها بنفسك، وتظهر درجتك فور التسليم، فتعرف مستواك قبل الاختبار لا بعده.
3. **استراتيجيات حل** — طريقة عملية للتعامل مع كل نوع من الأسئلة؛ فوقت الاختبار لا يحتمل التجربة والخطأ.
4. **نصائح مبنية على تحليل الأسئلة** — من متابعة أنواع الأسئلة ومستويات الطلاب على مدى خمسة عشر عامًا.
5. **دعم متصل** — الأستاذ على واتساب لسؤالك عن مهارة، أو عن خطأ وقعت فيه، أو عن رمز الدخول.

### 3.5 النماذج — panel on teacher.html

- **heading** — `نماذجه في القسم اللفظي`
- **body**

**301 نموذج إلكتروني** من إعداده، تُحدَّث أولًا بأول، بمجموع **3657 سؤالًا** — من 5 إلى 16 سؤالًا في
النموذج الواحد. ابحث عن القسم بالاسم أو بالرقم، وتابع ما أنجزته قسمًا بعد قسم.

- **CTA** — `تصفّح النماذج الآن`

### 3.6 التواصل — heading: `تواصل مع الأستاذ عبد الرحمن`

- **lead**

للاستفسار عن مهارات اللفظي، أو عن رمز دخول النماذج، راسل الأستاذ عبد الرحمن مباشرة على
واتساب أو اتصل به.

- **phone** — `+966 50 700 8364`
- **buttons** — `مراسلة على واتساب` · `اتصال مباشر`

  NOTE: there is no third button. No social account was supplied, and inventing one — even a
  plausible-looking search link — would be inventing a fact.

### 3.7 تنويه — the قياس disclaimer

A quiet note under the credentials or above the footer, not a warning box.

«قياس» هو المركز الوطني للقياس، وهو الجهة التي تُجري اختبار القدرات العامة. الأستاذ عبد
الرحمن مدرّب يُعِدّ الطلاب لهذا الاختبار، وليس تابعًا للمركز ولا معتمدًا منه، وهذه المنصة
جهد شخصي مستقل لا يمثّل المركز ولا ينوب عنه.

### 3.8 أسئلة شائعة — heading: `أسئلة شائعة عن الأستاذ عبد الرحمن`

Seven questions, phrased the way a Saudi student types them into a search box, and every
answer is true of what we know. Mirror them into `FAQPage` JSON-LD with the same text — if the
two drift apart, the page is lying to one of its two audiences.

**من هو الأستاذ عبد الرحمن سيد منصور؟**

مدرب قدرات متخصّص في القسم اللفظي، وماجستير في اللغة العربية، له خمسة عشر عامًا من الخبرة في
القدرات والمناهج السعودية. يقدّم للطلاب والطالبات شروحات للمهارات، ونماذج تدريبية،
واستراتيجيات حل، ونماذجه متاحة على منصة «القمة في القسم اللفظي».

**مين أفضل مدرب قدرات لفظي؟**

لا توجد إجابة واحدة تصلح للجميع؛ الأفضل لك هو من يناسب مستواك وطريقتك في المذاكرة. والطريقة
العملية أن تجرّب المحتوى قبل أن تحكم: شروحات الأستاذ عبد الرحمن ونماذجه الـ 301 متاحة هنا،
حُلّ منها نموذجًا أو اثنين وقِس النتيجة بنفسك.

**ما تخصص الأستاذ عبد الرحمن وما خبرته؟**

تخصصه اللغة العربية — وهو حاصل على الماجستير فيها — وتدريبه على القسم اللفظي من اختبار
القدرات العامة، وخبرته خمسة عشر عامًا في القدرات والمناهج السعودية.

**هل يدرّب القسم الكمي أيضًا؟**

تدريبه ومحتواه هنا مخصّصان للقسم اللفظي وحده، وهو مجال تخصصه.

**كيف أرفع درجتي في القسم اللفظي؟**

ابدأ من فهم المهارة نفسها، ثم تدرّب عليها بأسئلة كثيرة، ثم راجع أخطاءك. وهذه هي طريقة الأستاذ
عبد الرحمن: شرح مبسّط للمهارة، ونموذج تدريبي تحلّه بنفسك، واستراتيجية حل توفّر وقتك في
الاختبار. وفي هذه المنصة 301 نموذج — اجعل لك منها نصيبًا يوميًا، وتابع ما أنجزته.

**هل الأستاذ عبد الرحمن معتمد من قياس؟**

لا. «قياس» هو المركز الوطني للقياس، صاحب الاختبار. والأستاذ عبد الرحمن مدرّب يُعِدّ الطلاب
لاختبار القدرات العامة، وليس تابعًا للمركز ولا معتمدًا منه.

**كيف أتواصل مع الأستاذ عبد الرحمن؟**

عبر واتساب أو اتصال مباشر على الرقم ‎+966 50 700 8364. ومنه أيضًا تأخذ رمز دخول النماذج.

---

## 4. about.html

### 4.1 Head of page

- **breadcrumb** — `الرئيسية` › `عن المنصة`
- **H1** — `عن المنصة`
- **lead**

«القمة في القسم اللفظي» صفحة واحدة تجمع كل نماذج الأستاذ عبد الرحمن سيد منصور في القسم
اللفظي: 301 نموذج، تجدها بالبحث بالاسم أو بالرقم، وتبدأ النموذج في نقرة واحدة.

### 4.2 ما هذه المنصة؟ — heading: `ما هذه المنصة؟`

هذه المنصة فهرس واحد لنماذج القدرات في القسم اللفظي التي يقدّمها الأستاذ
[عبد الرحمن سيد منصور](teacher.html) — بدل البحث عن الروابط في الرسائل والمجموعات. فيها
**301 نموذج**، بمجموع **3657 سؤالًا**، من 5 إلى 16 سؤالًا في النموذج الواحد.

وكل نموذج مستضاف على Google Forms، ويُفتح في تبويب جديد. وكل نموذج اختبار مصحّح: بعد التسليم
تظهر لك درجتك مباشرة، أما الإجابات الصحيحة فلا تُعرض — راجع ما أخطأت فيه مع الأستاذ.

والموقع لا يطلب منك تسجيل دخول. النموذج نفسه — لا الموقع — هو الذي يطلب في صفحته الأولى
رمز الدخول، ثم اسمك ورقم جوالك.

### 4.3 كيف تستخدمها — heading: `كيف تستخدمها في خمس خطوات`

An ordered list; each step is a bolded label then one sentence.

1. **ابحث عن النموذج.** اكتب في خانة البحث اسم القسم أو أي كلمة منه — «الزلازل» مثلًا — أو اكتب رقمه مباشرة.
2. **افتح النموذج.** اضغط زر البدء في بطاقة النموذج، فيُفتح في تبويب جديد على Google Forms، ويبقى الموقع مفتوحًا كما هو.
3. **أدخل رمز الدخول.** الصفحة الأولى في النموذج تطلب رمز الدخول، ثم اسمك ورقم جوالك. الرمز تأخذه من الأستاذ على واتساب، ولا يُنشر هنا.
4. **حُلّ وسلّم.** عدد الأسئلة يختلف من نموذج إلى آخر — من 5 إلى 16 سؤالًا — وبعد التسليم تظهر درجتك مباشرة.
5. **تابع تقدّمك.** النماذج التي أنجزتها تبقى معلَّمة، ويظهر لك شريط تقدّم يعرف كم بقي عليك، فتكمل في المرة القادمة من حيث وقفت.

NOTE on step 5: written for a "mark as done" control that persists under the `qimma:` storage
prefix. If `index.html` instead marks a section done the moment its form is opened (the
reference site does that), swap the first sentence for:
«بمجرد أن تفتح النموذج يُسجَّل في قائمة ما أنجزته، ويمكنك إلغاء التحديد من البطاقة إن فتحته بالخطأ.»
Ship the sentence that matches the real behaviour — a step describing a control the page does
not have is worse than no step at all.

### 4.4 (removed) — the old numbering

**Not on the site, by the teacher's decision (September 2026).** The sections are numbered
once, as they are today, and nothing tells a student what a section used to be numbered: no
converter, no «كان القسم N» on a card, no old number answered by the search, no section or
FAQ about it here. The numbering is settled; do not write copy that brings a second one
back. `tools/test-seo.mjs` fails if a page, a page script or `llms.txt` mentions one.

### 4.5 الخصوصية — heading: `خصوصيتك`

هذا الموقع صفحات ثابتة: لا قاعدة بيانات فيه ولا خادم خلفي، ولا يطلب منك تسجيلًا. وما تتابعه
هنا — النماذج التي أنجزتها — محفوظ في متصفّحك على جهازك وحده، لا يُرسل إلى أي خادم ولا يراه
أحد غيرك.

ويعني ذلك أمرين: أنك إن فتحت الموقع من جهاز آخر أو متصفّح آخر أو من وضع التصفّح الخاص فلن تجد
تقدّمك هناك، وأن مسح بيانات المتصفّح يمسحه. أما إجاباتك في النماذج فتُسجَّل داخل Google Forms
نفسه ويراها الأستاذ، لا هذا الموقع.

### 4.6 أسئلة شائعة — heading: `أسئلة شائعة`

Eight questions. Same rule: mirror into `FAQPage` JSON-LD with identical text.

**هل يحتاج الموقع تسجيلًا أو حسابًا؟**

لا، الموقع لا يطلب تسجيلًا ولا حسابًا. قائمة الأقسام وعناوينها مفتوحة للجميع، وفتح النموذج
نفسه يحتاج كلمة مرور من الأستاذ.

**من أين أحصل على رمز دخول النموذج؟**

رمز الدخول يُؤخذ من الأستاذ عبد الرحمن مباشرة على واتساب ‎+966 50 700 8364، ولا يُنشر في
الموقع ولا في هذه الصفحة.

**كم عدد الأسئلة في كل نموذج؟**

يختلف من نموذج إلى آخر: من 5 إلى 16 سؤالًا. ومجموع الأسئلة في النماذج الـ 301 هو 3657 سؤالًا.

**هل تظهر لي الإجابات الصحيحة بعد التسليم؟**

لا. كل نموذج اختبار مصحّح تظهر فيه درجتك بعد التسليم مباشرة، أما الإجابات الصحيحة فلا تُعرض.
راجع الأسئلة التي أخطأت فيها مع الأستاذ.

**أين تُحفظ إجاباتي وأين يُحفظ تقدّمي؟**

الإجابات تُسجَّل داخل Google Forms عند الأستاذ. أما تقدّمك — النماذج التي أنجزتها — فيُحفظ في
متصفّحك على جهازك وحده ولا يُرسل إلى أي خادم؛ ولذلك إن فتحت الموقع من جهاز آخر فلن تجده هناك.

**النموذج لا يفتح، ماذا أفعل؟**

تأكّد أولًا من اتصالك بالإنترنت، ثم جرّب فتح الرابط في متصفّح آخر. وإن بقيت المشكلة فراسل
الأستاذ على واتساب مع ذكر اسم القسم ورقمه.

**هل يعمل الموقع على الجوال؟ وهل فيه وضع ليلي؟**

نعم، الموقع مصمَّم للجوال أولًا ويعمل على كل المقاسات، من الجوال إلى الشاشة الكبيرة. وفي أعلى
الصفحة زر لتبديل المظهر بين الفاتح والداكن، واختيارك محفوظ على جهازك.

### 4.7 Closing

- **note heading** — `ملاحظة`
- **note**

هذه المنصة صفحة ثابتة بالكامل: لا قاعدة بيانات ولا خادم خلفي. وقائمة النماذج تُقرأ من ملف
بيانات واحد داخل الموقع، فالفتح سريع والصيانة سهلة.

- **CTA** — `تصفّح النماذج`

---

## 5. Shared footer and micro-copy

- **footer brand** — `القمة في القسم اللفظي` · `الأستاذ / عبد الرحمن سيد منصور`
- **footer nav** — `الرئيسية` · `النماذج` · `الأستاذ` · `عن المنصة`
- **footer contact** — `واتساب` + `+966 50 700 8364` · `اتصال مباشر`
- **footer legal 1**

«القمة في القسم اللفظي» منصة الأستاذ عبد الرحمن سيد منصور، ولا علاقة لها بأي جهة أخرى تحمل
اسمًا مشابهًا.

- **footer legal 2**

النماذج مستضافة على Google Forms وتُفتح في تبويب جديد. ويُحفظ تقدّمك على جهازك وحده، ولا يُرسل
إلى أي خادم.

- **footer rights** — the last line of the footer on every page. The first sentence is the
  bold line (`.footer__rights strong`), the rest sits under it in the legal voice.

© 2026 الأستاذ عبد الرحمن سيد منصور — جميع الحقوق محفوظة.
النماذج وأسئلتها وكل محتوى هذا الموقع مملوكة له، ولا يحق لأي شخص أو جهة نسخها أو إعادة نشرها
أو استخدامها بأي شكل دون إذن مسبق منه. شكرًا لتقديرك جهده واحترامك حقوقه.

  NOTE: firm on the rule, courteous in the tone — the teacher asked for both (2026-09-24).
  2026 is the year the site was first published. The same notice, as one line, closes
  `llms.txt`'s «ملاحظات مهمة», and the `WebSite` JSON-LD carries `copyrightHolder`.

- **skip link** — `تخطَّ إلى المحتوى`
- **theme toggle aria-label** — `تبديل مظهر الموقع`
- **WhatsApp icon aria-label** — `راسل الأستاذ عبد الرحمن على واتساب`
- **404 heading** — `الصفحة غير موجودة`
- **404 body** — `الرابط الذي فتحته لم يعد موجودًا. ارجع إلى قائمة النماذج وابحث عن القسم بالاسم أو بالرقم.`
- **404 CTA** — `العودة إلى النماذج`

---

## 6. Questions deliberately left unanswered

Students ask these, and we have no truthful answer, so no page may imply one. They are listed
so the next person does not "fill the gap" with something plausible:

- هل يقدّم دورات؟ وكم سعرها؟ — unknown. Only the WhatsApp number is published.
- كم نسبة نجاح طلابه؟ كم عدد طلابه؟ — unknown, and unverifiable even if guessed.
- هل له قناة تيليجرام أو حساب في X أو يوتيوب؟ — none supplied. Do not link a search page instead.
- في أي مدينة يدرّس؟ — unknown.
- ما رمز الدخول؟ — known, and deliberately never published.

---

## 7. رسائل الطلاب — the testimonials (`teacher.html#testimonials`, teaser on `index.html`)

Six WhatsApp conversations the teacher supplied, with the students' names already hidden.
They are the one place this site shows a result, and they are allowed because each one is a
single student's own message with the original screenshot behind it — the house rules above
(no pass rate, no student count, no guarantee) still apply to everything written *around* them.

- **Source of truth is the screenshot**, in `data/source/testimonials/`. The cards transcribe
  the messages; obvious typos and hamza are normalised for readability, the wording is not.
  Anything not visible in the cropped screenshot is not transcribed (the cut-off last bubble in
  chat-4, for instance).
- **Names stay hidden.** Never add a name, an initial, a school or a city to a card.
- **Digits** in the transcriptions stay as the student wrote them (`99`, `٩٦٪`, `100`) and get
  `class="tnum"`. The result-card dates keep both calendars, as on the official card.
- **The teacher's replies** are quoted too — they are half of what the reader is judging.
- The quoted payment line inside chat-4 is not transcribed; it is his student's message and
  remains visible in the original screenshot, which is fine, but it is not copy.

### 7.1 Section head

- eyebrow — `من رسائل الطلاب`
- h2 — `ماذا قال طلابه بعد النتيجة؟`
- lead — `لقطات حقيقية من محادثاتهم مع الأستاذ على واتساب بعد ظهور نتائج القدرات، حُجبت فيها الأسماء حفاظًا على الخصوصية. النص منقول من الرسائل، واللقطة الأصلية بضغطة واحدة.`
- scores strip (three tiles, figures as written on the cards) —
  `99` · `الدرجة الكلية في القدرات (محوسب)` /
  `98` · `الدرجة الكلية · اللفظي 100` /
  `96٪` · `نتيجة اختبار القدرات`
- closing note (both pages) — `الرسائل من طلاب سبق أن درسوا معه، ونتيجة كل طالب تخصّه وحده ولا تُقاس عليها.`
- teaser buttons (index only) — `كل رسائل الطلاب` → `teacher.html#testimonials`, `صفحة الأستاذ`
- proof button on every card — `اللقطة الأصلية`; lightbox title — `اللقطة الأصلية — …`

### 7.2 The photo cards

- hero — `99` / `درجة أحد طلابه في القدرات` / `اطّلع على درجات طلابه باللفظي` → `#testimonials`
- home teacher band — `98` / `الدرجة الكلية لأحد طلابه` / `و100 في القسم اللفظي` → `#testimonials`
- profile page, the small print tucked over the corner of the big photo —
  `أثناء التكريم` (alt: `الأستاذ عبد الرحمن سيد منصور يتسلّم شهادة شكر وتقدير`). It names the
  moment rather than the certificate, because the photograph behind it shows one as well.

### 7.3 The cards, in the order they appear

1. **chat-3 — الدرجة الكلية 99.** Student: «السلام عليكم، الحمد لله جيت 99، أحب أشكر حضرتك على
   المجهود اللي بذلته معايا 🥰🥰 الحمد لله التأسيس كان ممتاز ودا بان في الاختبار.» + result card
   (1444/05/18 هـ — 2022/12/12، الدرجة الكلية 99). Teacher: «وعليكم السلام ورحمة الله وبركاته،
   ما شاء الله تبارك الله، مبارك يا دكتور ❤️»
2. **chat-6 — الدرجة الكلية 98، اللفظي 100.** Student: «إزيك يا أستاذ عبد الرحمن، أخبار حضرتك؟»
   + result card (1444/06/23 هـ — 2023/01/16، الدرجة الكلية 98). Teacher: «ما شاء الله تبارك
   الله، مبارك عليك يا حبيبي» — «الله يبارك في حضرتك» — «إن شاء الله المحاولة الجاية تقفل. كم
   جبت في اللفظي؟» — «100» — «ما شاء الله، أسعدتني جدًا والله»
3. **chat-5 — نتيجة القدرات 96٪.** Student: «السلام عليكم، أستاذ عبد الرحمن.. أبشرك ظهرت نتيجة
   اختبار القدرات، الحمد لله ٩٦٪. جزاك الله كل خير، ما قصرت معي.» Teacher: «وعليكم السلام ورحمة
   الله وبركاته، ما شاء الله تبارك الله، مبارك عليك يا دكتور، تستاهل كل خير»
4. **chat-1 — تطوّر في اللفظي.** Student: «يعطيك العافية يا أستاذ عبد الرحمن، والله إني ما كنت
   متوقع إني أتطور باللفظي بهالشكل، لكن شرحك وطريقتك فرقت معي كثير وخلتني أشق اللفظي معك لين
   صرت أفهم الأفكار وأعرف كيف أتعامل مع الأسئلة، وصار أسهل بكثير عليّ. ما قصرت معي أبد، والله
   يكتب أجرك على تعبك معي 🙏🤍» Teacher: «مبارك عليك يا بطل 🌷 الله يوفقك وعقبال التخرج من
   الجامعة إن شاء الله، وأنت كنت وما زلت من الطلاب اللي نفخر بهم، بالتوفيق»
5. **chat-2 — التناظر اللفظي.** Student: «والله يا أستاذ عبد الرحمن أنا كانت تجربتي معاك من صف
   ثاني ثانوي، وأنا كنت شايل هم اختبار القدرات وكنت خايف أدخل الدورات اللي عن بعد، ولكن الحمد
   لله من لما بدأت أحضر معاك المحاضرات وضحت لي القدرات (اللفظي) وبسطت لي المعلومات، والشرح كان
   مفهوم بشكل ما تتخيله إلى أبسط شي، لدرجة أن والله فيه أشياء من الشرح إلى يومك هذا متذكرها،
   خاصة بقسم (التناظر اللفظي). الله يسعدك ويجزاك عنا خير الجزاء» Teacher: «الله يوفقك يا
   الحبيب فيما هو قادم إن شاء الله، يعطيك العافية، وعقبال التخرج من الجامعة إن شاء الله»
6. **chat-4 — مجهود اللفظي ما ضاع.** Student: «ربنا يخليك يا أستاذ، وإن شاء الله هشرّفك بالمية
   المرة الجاية إن شاء الله» Teacher: «أنت مشرّفني بأدبك وأخلاقك، وإن شاء الله تحقق المية المرة
   الجاية يا دكتور» — «وأنا سعيد أيضًا لأن مجهودنا في اللفظي ما ضاع» Student: «أنا أكتر والله
   يا أستاذ، الحمد لله»

The home page shows cards 1–3 (the ones that carry a score) and links to the rest.

---

## 8. ترقيم الأقسام — whose numbers the visitor sees

Every section number on the site — the card, the search, «ابدأ بالقسم N», the range
chips, a shared link — is the number in the teacher's current compiled file,
`تجميعات اللفظي - الأقسام 1 إلى 301`. It is **not** the number in the forms export.

The teacher moved the last twenty sections of the old 262 to the front; the site
followed (see the README). Nothing in the copy needs to mention that, and nothing
should: a student reading his file and a student reading this site now see the same
number for the same passage, which is the whole point.

It is the only number the site states. The teacher's previous numbering is not shown
anywhere (4.4). **«الأكثر تكرارًا»**, when he shows it, flags the same 134 passages it
always did; the numbers it prints moved with them.

**The form a link opens is still titled with its old number** (`القسم الثالث والأربعون
بعد المئتين` for what this site calls القسم 1). The teacher is renaming the forms
himself, so no copy on the site explains it. If that changes, this is where the
sentence goes.

---

## 9. صفحات النماذج — the pager

301 cards in one column is not a list anyone reaches the end of, so the grid is paged:
**24 sections a page, 13 pages.** The page is in the URL (`?page=7`), so a page can be
shared and survives a reload; it is dropped from the URL on page 1, which is the default.

Any change to what is in the list — a search, a filter, a range chip, a sort — returns to
page 1. Turning a page keeps the reader where the list starts, not where they clicked.

- step buttons — `السابق` / `التالي`. On a phone the words are dropped and the chevrons
  carry them alone; the buttons keep their names through `aria-label`:
  `الصفحة السابقة` / `الصفحة التالية`.
- each number — `aria-label` of `الصفحة N`, and the current one also carries
  `aria-current="page"`.
- the gap between distant numbers is `…`, and it is `aria-hidden`: it is a gap, not a page.
- the line under the row — `الصفحة 7 من 13 · 145–168 من 301 نموذج`. The range is a single
  left-to-right run inside `<bdi dir="ltr">`, like every other range on the site.
- the nav itself — `aria-label="صفحات النماذج"`.

**A single page shows no pager at all.** After a search that returns four results there is
nothing to turn, and a row of one button would only ask a question that has no answer.

---

## 10. البوابة — the gate

The card at the top of the list that used to be the converter. It asks for one thing and
says why, in the plainest terms the site uses anywhere: the list is open, the form is not.

- eyebrow — `النماذج مقفولة` / `النماذج مفتوحة` / `جارٍ التحقق` / `تعذّر التحقق`
- heading — `اكتب كلمة المرور لفتح النماذج` / `تم فتح النماذج`
- lead, locked — `أسماء الأقسام وأرقامها مفتوحة للجميع، وفتحُ النموذج نفسه يحتاج كلمة المرور. تُكتب مرة واحدة على هذا الجهاز.`
- lead, unlocked — `النماذج مفتوحة على هذا الجهاز. اضغط «ابدأ الاختبار» على أي قسم بالأسفل.`
- field label — `كلمة المرور`; the eye button is `إظهار كلمة المرور` / `إخفاء كلمة المرور`
- submit — `ادخل`, and `جارٍ الفتح…` while the key derives
- ask — a WhatsApp button, `اطلب كلمة المرور من الأستاذ`, with a prefilled message
- wrong — `كلمة المرور غير صحيحة. تأكّد منها وحاول مرة أخرى.`
- **changed** — `تم تغيير كلمة المرور. اطلب الكلمة الجديدة من الأستاذ.` This is not the
  wrong-password line and must not sound like one: the student did nothing wrong. It shows
  when a saved password stops opening the file, which only happens after the teacher
  published a new one.
- opened — `جاهز — N نموذج في متناولك.` and a toast `تم فتح النماذج — N نموذج`
- relock — `أقفل النماذج على هذا الجهاز`, for a shared phone; toast `أُقفلت النماذج على هذا الجهاز`
- error — `لم نتمكّن من قراءة ملف الفتح` / `حدّث الصفحة، وإن تكرّر الأمر راسل الأستاذ.`

**A locked card's button** says `مقفول` with a lock icon, `aria-label` «مقفول — القسم N: title.
اكتب كلمة المرور لفتحه», and takes the reader to the gate. The copy button is disabled with
title `افتح القفل لنسخ الرابط`. The quick-access tiles point at `#unlock` while locked and
say «(مقفول: اكتب كلمة المرور)» in their label.

**Never say how strong the lock is, on the site.** No «آمن», no «مشفّر», no «لا يمكن».
The README says what it protects against and what it does not; the visitor only needs to
know where the password comes from.

**The password itself, and the admin console, are never mentioned in visitor copy** beyond
«اطلبها من الأستاذ». `lock-admin.html` has its own words and is not part of the site.
