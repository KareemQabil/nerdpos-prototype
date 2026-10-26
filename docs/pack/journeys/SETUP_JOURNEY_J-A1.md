# Setup from zero: journey J-A1 and client implementation runbook (NP-W-03)

**Generated** by `reference-tools/author_worker_w9.py` from canonical V4 and the DOMAIN fragments on `agent/claude/domain-line` @ `f4b90711` (manifest 3.7.0). Do not edit by hand. Evidence state: SPEC_ONLY; it becomes evidence only when an installation run fills the capture items.

**Delivery model:** one dedicated deployment and database per client, installed, configured and tested by our implementation team (DOMAIN unified plan section 0). No secret is ever written here: credentials come from the environment or the secure issuance sink.

**Every step captures:** a screenshot (legacy design), the HTTP status, error code and X-Command-Id of each command.

## Roles created in step 5

| Role | Permissions |
|---|---|
| owner | `business:configure`, `business:read`, `branch:create`, `branch:configure`, `branch:read`, `terminal:register`, `terminal:update`, `terminal:read`, `role:create`, `role:read`, `role:update`, `user:create`, `user:read`, `user:manageaccess`, `credential:reset`, `settings:read`, `settings:updatepolicy`, `tax:manage`, `tax:read`, `catalog:manage`, `catalog:upsertitem`, `catalog:setprice`, `catalog:read`, `product:setavailability`, `product:read`, `table:upsert`, `table:read`, `kitchen:configure`, `kitchen:read`, `reasoncode:upsert`, `report:run`, `session:read`, `session:xreport`, `session:zreport`, `approve:sensitive_policy_change`, `approve:session_variance`, `approve:line_void`, `approve:order_void`, `approve:refund_approve`, `approve:order_discount` |
| manager | `order:read`, `payment:read`, `catalog:read`, `catalog:setprice`, `product:setavailability`, `product:read`, `table:read`, `kitchen:read`, `settings:read`, `report:run`, `session:read`, `session:xreport`, `session:zreport`, `approve:session_variance`, `approve:line_void`, `approve:order_void`, `approve:refund_approve`, `approve:order_discount` |
| cashier | `session:open`, `session:read`, `session:close`, `session:xreport`, `catalog:read`, `order:create`, `order:addlines`, `order:confirm`, `order:complete`, `order:read`, `payment:capture`, `payment:read`, `settings:read`, `report:run` |
| waiter | `table:read`, `table:assign`, `table:release`, `catalog:read`, `order:create`, `order:addlines`, `order:updateline`, `order:removeline`, `order:fire`, `order:read`, `order:confirm`, `settings:read` |
| chef | `kitchen:read`, `kitchen:advanceticket` |

Actors: `implementation-engineer` (our team, bootstrap credential; platform and provisioning steps), `owner-1`, `manager-1`, `cashier-1`, `waiter-1`, `chef-1` (created in step 5).

## Phase A: Install the dedicated deployment

<div dir="rtl">تركيب السيرفر الخاص بالعميل</div>

### J-A1 · step 1

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Provision one dedicated deployment and database for this client (no shared tenant). Apply the reviewed migrations with the release runner. Configure secrets only through the environment (never in this file). |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">جهّز سيرفر وقاعدة بيانات خاصين بالعميل ده بس. شغّل الـ migrations المراجعة بأداة الإصدار. الأسرار تتحط في البيئة بس، عمرها ما تتكتب هنا.</div> |
| Expect | Readiness reports the database and the reviewed migration head (RUNBOOK.md). |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">فحص الجاهزية يقول إن قاعدة البيانات شغالة وآخر migration هو المراجع (RUNBOOK.md).</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Health.Live` | canonical | GET /health/live | implementation-engineer · `PUBLIC` | 200 |
| `Health.Ready` | canonical | GET /health/ready | implementation-engineer · `PUBLIC` | 200 with database and migration head |
| `Platform.BuildInfo` | canonical | GET /meta/build | implementation-engineer · `platform:read` | release version and commit |

### J-A1 · step 2

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Log in with the bootstrap administrator issued by the environment (secure sink). Configure the business: names AR/EN and legal names. The ETA issuer identity is NOT entered here (E-40: compliance.FiscalProfile). |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">ادخل بحساب المسؤول المبدئي اللي البيئة طلعته. اكتب بيانات النشاط: الأسماء عربي وإنجليزي والاسم القانوني. بيانات التسجيل في الفاتورة الإلكترونية مش هنا (E-40).</div> |
| Expect | Business.Get returns the names; no fiscal field exists on the business record. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">Business.Get يرجّع الأسماء، ومفيش أي حقل ضريبي على سجل النشاط.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Auth.Login` | canonical | POST /auth/login | implementation-engineer · `PUBLIC` | authenticated |
| `Business.Configure` | canonical | PUT /business | implementation-engineer · `business:configure` | 200, names stored |
| `Business.Get` | canonical | GET /business | implementation-engineer · `business:read` | the configured business |

## Phase B: Branches, devices, roles and people

<div dir="rtl">الفروع والأجهزة والصلاحيات والناس</div>

### J-A1 · step 3

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Create the branch with its calendar: timezone Africa/Cairo, business-day cutoff 04:00 (EG profile EG-BRANCH-CALENDAR, MEDIUM: confirm the closing hour with the owner). |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">أنشئ الفرع بالتقويم بتاعه: المنطقة الزمنية Africa/Cairo وبداية اليوم التجاري 04:00 (اسأل صاحب المطعم الساعة كام بيقفل).</div> |
| Expect | Branch ACTIVE; the server resolves business dates from these fields for every financial command. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الفرع ACTIVE، والسيرفر بيحسب اليوم التجاري من الحقول دي لكل عملية مالية.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Branch.Create` | canonical | POST /branches | implementation-engineer · `branch:create` | 201, branch ACTIVE |
| `Branch.Get` | canonical | GET /branches/{branchId} | implementation-engineer · `branch:read` | timezone and cutoff as entered |

### J-A1 · step 4

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Register the devices: one cashier terminal with a drawer, one floor tablet per waiter group (no drawer), one kitchen display, one admin terminal. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">سجّل الأجهزة: جهاز كاشير بدرج، تابلت لكل مجموعة جرسونات من غير درج، شاشة مطبخ، وجهاز إدارة.</div> |
| Expect | Terminal.List shows the four kinds; only the cashier terminal has a drawer. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">Terminal.List يعرض الأنواع الأربعة، وجهاز الكاشير بس اللي عليه درج.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Terminal.Register` | canonical | POST /terminals | implementation-engineer · `terminal:register` | 201 per device |
| `Terminal.List` | canonical | GET /terminals | implementation-engineer · `terminal:read` | the registered devices |

### J-A1 · step 5

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Create the roles owner, manager, cashier, waiter and chef with the permission sets of section "Roles" below. Create the users, give each a role and the branch scope. PINs and passwords are issued by Credential.Reset to the person directly (secure issuance sink), never typed here. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">أنشئ الصلاحيات: مالك، مدير، كاشير، جرسون، شيف بالمجموعات اللي في جزء "الصلاحيات" تحت. أنشئ المستخدمين وادي كل واحد صلاحيته والفرع. الـ PIN وكلمات السر تطلع للشخص نفسه، عمرها ما تتكتب هنا.</div> |
| Expect | Role.List shows five roles; each user sees only the branch it was given. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">Role.List يعرض خمس صلاحيات، وكل مستخدم يشوف الفرع بتاعه بس.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Role.Create` | canonical | POST /roles | implementation-engineer · `role:create` | 201 per role |
| `User.Create` | canonical | POST /users | implementation-engineer · `user:create` | 201 per user |
| `User.ManageAccess` | canonical | POST /users/{userId}/access | implementation-engineer · `user:manageaccess` | role and branch scope set |
| `Credential.Reset` | canonical | POST /users/{userId}/credentials/reset | implementation-engineer · `credential:reset` | credential issued to the person |

## Phase C: Policies, tax and reason codes

<div dir="rtl">السياسات والضريبة وأسباب الإلغاء</div>

### J-A1 · step 6

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Apply the Egypt market profile once with the provisioning tool (settings.ApplyMarketProfile, internal). Then review every value with the owner. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">طبّق ملف السوق المصري مرة واحدة بأداة التجهيز. بعدها راجع كل قيمة مع صاحب المطعم.</div> |
| Expect | Settings.Effective for FloorIntakePolicy (DINE_IN) shows FLOOR_WITHOUT_DRAWER from TENANT; a second application is refused. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">Settings.Effective لـ FloorIntakePolicy يرجّع FLOOR_WITHOUT_DRAWER، والتطبيق التاني يترفض.</div> |
| Policies | `FloorIntakePolicy`, `CollectionScopePolicy`, `ServiceChargePolicy`, `OrderConfirmationPricingPolicy` |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `settings.ApplyMarketProfile` | settings/operation/settings.ApplyMarketProfile@1 | internal (no HTTP) | implementation-engineer · `INTERNAL` | one row per profile value, policyVersion 1 |
| `settings.ApplyMarketProfile` | settings/operation/settings.ApplyMarketProfile@1 | internal (no HTTP) | implementation-engineer · `INTERNAL` | second application refused<br>`SETTINGS_PROFILE_ALREADY_APPLIED` |
| `Settings.Effective` | settings/operation/Settings.Effective@1 | GET /settings/effective | owner-1 · `settings:read` ✓ | value, resolvedScope TENANT |

### J-A1 · step 7

| | |
|---|---|
| Who | `owner-1` |
| Do | Create the VAT tax policy from the profile (14 %, EXCLUSIVE, HALF_UP, 2). Have the accountant confirm it before the first real sale. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">أنشئ ضريبة القيمة المضافة من الملف (14%، غير شاملة، تقريب HALF_UP لرقمين). المحاسب لازم يأكدها قبل أول بيع حقيقي.</div> |
| Expect | TaxPolicy.List shows VAT active, version 1. A second identical policy is allowed but should not be created. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">TaxPolicy.List يعرض الضريبة نشطة. ممكن تتعمل تاني بس ما ينفعش.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `TaxPolicy.Create` | taxes/operation/TaxPolicy.Create@1 | POST /tax-policies | owner-1 · `tax:manage` ✓ | 201, VAT active |
| `TaxPolicy.List` | taxes/operation/TaxPolicy.List@1 | GET /tax-policies | owner-1 · `tax:read` ✓ | VAT listed |

### J-A1 · step 8

| | |
|---|---|
| Who | `owner-1` |
| Do | Create the reason codes of the profile (owner data EG-REASON-CODES), then switch ReasonCodePolicy to MANAGED for those kinds. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">أنشئ أسباب الإلغاء والخصم من الملف، وبعدها حوّل ReasonCodePolicy لـ MANAGED.</div> |
| Expect | ReasonCode.List shows the codes in Arabic and English. Switching a kind to MANAGED with no code is refused. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">ReasonCode.List يعرض الأسباب بالعربي والإنجليزي. تحويل نوع لـ MANAGED من غير أسباب يترفض.</div> |
| Policies | `ReasonCodePolicy` |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `ReasonCode.Create` | settings/operation/ReasonCode.Create@1 | POST /reason-codes | owner-1 · `reasoncode:upsert` ✓ | 201 per code |
| `ReasonCode.Create` | settings/operation/ReasonCode.Create@1 | POST /reason-codes | owner-1 · `reasoncode:upsert` ✓ | same kind and code again<br>`REASON_CODE_TAKEN` |
| `ReasonCode.List` | settings/operation/ReasonCode.List@1 | GET /reason-codes | owner-1 · `settings:read` ✓ | active codes by kind |

## Phase D: Menu

<div dir="rtl">المنيو</div>

### J-A1 · step 9

| | |
|---|---|
| Who | `owner-1` |
| Do | Import the menu sheet with Catalog.Import: first dryRun true, fix every issue, then dryRun false. The import is all-or-nothing: units, categories, modifier groups and options, products, first prices per branch and channel, and availability. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">استورد شيت المنيو بـ Catalog.Import: الأول تجربة (dryRun) وصلّح كل الأخطاء، وبعدها استيراد حقيقي. يا كله يدخل يا مفيش حاجة.</div> |
| Expect | The dry run lists every issue with section, row and field; the real run creates everything in one transaction. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">التجربة بتعرض كل خطأ بالقسم والسطر والحقل، والاستيراد الحقيقي بيعمل كل حاجة مرة واحدة.</div> |
| Policies | `SkuGenerationPolicy`, `ProductNameUniquenessPolicy` |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Catalog.Import` | catalog/operation/Catalog.Import@1 | POST /catalog/import | owner-1 · `catalog:manage` ✓ | dryRun: VALID or INVALID with issues; nothing written |
| `Catalog.Import` | catalog/operation/Catalog.Import@1 | POST /catalog/import | owner-1 · `catalog:manage` ✓ | any issue on the real run: nothing written<br>`VALIDATION_FAILED` |
| `Catalog.Import` | catalog/operation/Catalog.Import@1 | POST /catalog/import | owner-1 · `catalog:manage` ✓ | real run: every row created |

### J-A1 · step 10

| | |
|---|---|
| Who | `owner-1` |
| Do | Without a sheet, the same in the admin screens: a unit, a category, a modifier group with options, a product, its modifier groups, its price per branch and channel, and its availability. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">من غير شيت، نفس الكلام من شاشات الإدارة: وحدة، قسم، مجموعة إضافات، صنف، سعره لكل فرع وطريقة بيع، وإتاحته.</div> |
| Expect | A quote of the product in the branch and DINE_IN returns the price; before the price it is refused (price not found). |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">تسعيرة الصنف في الفرع للصالة ترجّع السعر؛ قبل السعر بترجّع "مفيش سعر".</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Unit.Create` | catalog/operation/Unit.Create@1 | POST /units | owner-1 · `catalog:manage` ✓ | 201 |
| `Category.Create` | catalog/operation/Category.Create@1 | POST /categories | owner-1 · `catalog:manage` ✓ | 201 |
| `ModifierGroup.Create` | catalog/operation/ModifierGroup.Create@1 | POST /modifier-groups | owner-1 · `catalog:manage` ✓ | 201 |
| `ModifierOption.Create` | catalog/operation/ModifierOption.Create@1 | POST /modifier-groups/{groupId}/options | owner-1 · `catalog:manage` ✓ | 201 |
| `Product.Create` | catalog/operation/Product.Create@2 | POST /catalog/products | owner-1 · `catalog:upsertitem` ✓ | 201; same name again refused under BLOCK (Product.Create@3, agent/opus/delegated-bumps)<br>`CATALOG_PRODUCT_NAME_TAKEN` |
| `Product.SetModifierGroups` | catalog/operation/Product.SetModifierGroups@1 | PUT /catalog/products/{productId}/modifier-groups | owner-1 · `catalog:manage` ✓ | 200 |
| `Pricing.QuoteItem` | canonical | POST /pricing/items/{productId}/quote | owner-1 · `catalog:read` ✓ | before any price<br>`PRICE_NOT_FOUND` |
| `Catalog.SetPrice` | pricing/operation/Catalog.SetPrice@2 | PUT /catalog/products/{productId}/price | owner-1 · `catalog:setprice` ✓ | FIRST_PRICE per branch and channel |
| `Product.SetAvailability` | catalog/operation/Product.SetAvailability@1 | POST /catalog/products/{productId}/availability | owner-1 · `product:setavailability` ✓ | AVAILABLE |
| `Pricing.QuoteItem` | canonical | POST /pricing/items/{productId}/quote | owner-1 · `catalog:read` ✓ | the server price |

## Phase E: Floor and kitchen

<div dir="rtl">الصالة والمطبخ</div>

### J-A1 · step 11

| | |
|---|---|
| Who | `owner-1` |
| Do | Create the tables, the kitchen stations and the routing rules, ending with an explicit catch-all rule (no implicit default station). |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">أنشئ الترابيزات ومحطات المطبخ وقواعد التوجيه، وآخر قاعدة "أي حاجة تانية" بشكل صريح.</div> |
| Expect | RoutingRule.List: ascending priority, the catch-all last. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">RoutingRule.List: بالترتيب، والقاعدة العامة في الآخر.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Table.Create` | tables/operation/Table.Create@2 | POST /tables | owner-1 · `table:upsert` ✓ | 201 per table |
| `Table.Create` | tables/operation/Table.Create@2 | POST /tables | owner-1 · `table:upsert` ✓ | duplicate name<br>`TABLE_NAME_TAKEN` |
| `KitchenStation.Create` | kitchen_routing/operation/KitchenStation.Create@2 | POST /kitchen/stations | owner-1 · `kitchen:configure` ✓ | 201 per station |
| `RoutingRule.Create` | kitchen_routing/operation/RoutingRule.Create@2 | POST /kitchen/routing-rules | owner-1 · `kitchen:configure` ✓ | 201 per rule |
| `RoutingRule.List` | kitchen_routing/operation/RoutingRule.List@1 | GET /kitchen/routing-rules | owner-1 · `kitchen:read` ✓ | priority order |

## Phase F: Devices and fiscal registration

<div dir="rtl">الأجهزة والتسجيل الضريبي</div>

### J-A1 · step 12

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Connect printers and the cash drawer per terminal and print a test page. A printer failure must never block a sale (W13 docs/30). |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">وصّل الطابعات ودرج الفلوس لكل جهاز واطبع صفحة تجربة. عطل الطابعة عمره ما يوقف البيع.</div> |
| Expect | Test page printed; unplugging the printer leaves selling possible and shows the failed job. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">صفحة التجربة اتطبعت؛ لو فصلت الطابعة البيع يكمل والمهمة الفاشلة تظهر.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Terminal.Update` | canonical | PUT /terminals/{terminalId} | implementation-engineer · `terminal:update` | device configuration stored |
| `PrintJob.Find` | canonical | GET /print-jobs | implementation-engineer · `print:read` | failed job visible (printing is specified by F2: W13 docs/30) |

### J-A1 · step 13

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Register the restaurant with the e-receipt system in SANDBOX first; enter the issuer identity and the item mappings in compliance (E-40). PRODUCTION only after certification and the accountant's answers (OD-EG). |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">سجّل المطعم في منظومة الإيصال الإلكتروني على بيئة التجربة الأول، وبيانات المُصدر وأكواد الأصناف في وحدة الامتثال. الإنتاج بعد الاعتماد وردود المحاسب.</div> |
| Expect | A test receipt is accepted by the sandbox; a rejected one is listed for the manager and never edits the sale. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">إيصال تجربة يتقبل في بيئة التجربة؛ المرفوض يظهر للمدير وعمره ما يعدّل البيع.</div> |
| Policies | `FiscalDocumentPolicy` |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `FiscalProfile.Configure` | compliance/operation/FiscalProfile.Configure@1 | PUT /compliance/fiscal-profiles/{branchId} | implementation-engineer · `compliance:issuedocument` | issuer identity of the branch (E-40) |
| `FiscalDevice.Register` | compliance/operation/FiscalDevice.Register@1 | POST /compliance/fiscal-devices | implementation-engineer · `compliance:issuedocument` | one fiscal device per issuing terminal; its credential is a secret-store reference |
| `FiscalItemMapping.SetMany` | compliance/operation/FiscalItemMapping.SetMany@1 | PUT /compliance/item-mappings | implementation-engineer · `compliance:issuedocument` | item type and code per product (accountant data, OD-EG-3) |
| `Settings.Effective` | settings/operation/Settings.Effective@1 | GET /settings/effective | owner-1 · `settings:read` ✓ | FiscalDocumentPolicy SANDBOX from the profile |

## Phase G: First sale and first close

<div dir="rtl">أول بيعة وأول قفلة</div>

### J-A1 · step 14

| | |
|---|---|
| Who | `cashier-1` |
| Do | On the cashier terminal: open a shift with the opening float, sell one product for TAKEAWAY, take cash, complete, look at the X report, close the shift with a count. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">على جهاز الكاشير: افتح وردية برصيد افتتاحي، بيع صنف تيك أواي، خد كاش، اقفل الطلب، شوف تقرير X، واقفل الوردية بالعد.</div> |
| Expect | Every amount comes from the server. The X report shows the cash line; the Z is frozen after the close. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">كل الأرقام من السيرفر. تقرير X يعرض الكاش، وتقرير Z يتقفل بعد القفلة.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Auth.Login` | canonical | POST /auth/login | cashier-1 · `PUBLIC` | authenticated on the cashier terminal |
| `Session.Open` | canonical | POST /sessions | cashier-1 · `session:open` ✓ | 201, OPEN |
| `Order.Create` | canonical | POST /orders | cashier-1 · `order:create` ✓ | 201, TAKEAWAY, DRAFT |
| `Order.AddLines` | canonical | POST /orders/{orderId}/lines | cashier-1 · `order:addlines` ✓ | captured server price |
| `Order.Confirm` | canonical | POST /orders/{orderId}/confirm | cashier-1 · `order:confirm` ✓ | CONFIRMED |
| `Payment.Capture` | canonical | POST /orders/{orderId}/payments | cashier-1 · `payment:capture` ✓ | cash captured |
| `Order.Complete` | canonical | POST /orders/{orderId}/complete | cashier-1 · `order:complete` ✓ | COMPLETED |
| `Session.XReport` | canonical | GET /sessions/{sessionId}/x-report | cashier-1 · `session:xreport` ✓ | live X |
| `Session.Close` | canonical | POST /sessions/{sessionId}/close | cashier-1 · `session:close` ✓ | closed with count; variance per policy |

### J-A1 · step 15

| | |
|---|---|
| Who | `manager-1` |
| Do | As the manager, run the daily sales and tenders reports for today. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">كمدير، شغّل تقرير مبيعات اليوم وتقرير وسائل الدفع.</div> |
| Expect | Daily sales shows the one order; tenders shows gross captured, refunded and net collected equal to the Z. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">المبيعات تعرض الطلب الوحيد، ووسائل الدفع تعرض الإجمالي والمرتجع والصافي زي تقرير Z.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Session.ZReport` | canonical | GET /sessions/{sessionId}/z-report | manager-1 · `session:zreport` ✓ | frozen Z |
| `Report.Run` | canonical | GET /reports/{reportId} | manager-1 · `report:run` ✓ | daily_sales and tenders (W8) |

## Phase H: Backup drill and handover

<div dir="rtl">تجربة النسخ الاحتياطي والتسليم</div>

### J-A1 · step 16

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Take a backup, restore it to a scratch database, and prove the restored install reaches readiness and shows the first sale. Record the measured RPO and RTO in the handover (W12 docs/29). |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">خد نسخة احتياطية، رجّعها على قاعدة تجربة، واتأكد إنها جاهزة وفيها أول بيعة. سجّل الأرقام في محضر التسليم.</div> |
| Expect | Restored readiness 200; the first order and the Z are present and identical. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الجاهزية بعد الاسترجاع 200، وأول طلب وتقرير Z موجودين زي ما هم.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Health.Ready` | canonical | GET /health/ready | implementation-engineer · `PUBLIC` | 200 on the restored database |
| `Order.Find` | canonical | GET /orders | manager-1 · `order:read` ✓ | the first order |

### J-A1 · step 17

| | |
|---|---|
| Who | `implementation-engineer` |
| Do | Train each role with the operator walkthrough J-R1..J-R4 and the negative controls N1..N12 on the client install, then hand over: owner credentials issued, profile questions answered or recorded. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">درّب كل صلاحية على رحلات J-R1 لـ J-R4 والاختبارات السلبية N1 لـ N12، وبعدها سلّم: بيانات المالك اتسلمت، وأسئلة الملف اتجاوبت أو اتسجلت.</div> |
| Expect | Signed handover sheet; open expert questions listed with their owner. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">محضر تسليم متوقّع، والأسئلة المفتوحة متسجلة باسم المسؤول عنها.</div> |

## Pending operations

Rows marked PENDING name the slice that will specify them. They are listed so the installation checklist is complete. They are not invented operations.

