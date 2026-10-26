# Operator walkthrough J-R1..J-R4 (NP-W-01)

**Generated** by `reference-tools/author_acceptance_scripts.py` from canonical V4, DOMAIN manifest 2.9.0, docs/13 and demo data 1.1.0. Do not edit by hand. Evidence state of this document: SPEC_ONLY. It becomes evidence only when a run fills the capture items (evidence folder of the run) on the L1 environment (NP-R-13) with demo data 1.1.0.

**Rule for every step:** the screen shows server values only. The browser formats money; it never computes a price, total, tax, change, remaining amount or variance (docs/17, docs/18). Numbers marked "tester reference" are for the tester's check only.

## Preconditions

- L1 environment (NP-R-13) provisioned with `demo-provisioning.json` 1.1.0; credentials come from the environment variables it names and are never written here.
- No shift open on `DEMO-CASH-1`; table 7 free; Africa/Cairo clock.
- Devices: `DEMO-FLOOR-1` (waiter tablet, no drawer), `DEMO-CASH-1` (cashier, drawer), `DEMO-KDS-1` (kitchen), `DEMO-ADMIN-1` (manager).
- The app shows the X-Command-Id of each command in its debug panel (needed for N2, N12).

## Every step captures

- a screenshot of the expected screen (legacy design, LEGACY_UI_PARITY);
- the HTTP status, error code (if any) and X-Command-Id of each command;
- for money steps, the server response body (totals, captures, settlement).

## J-R1: Dine-in service with two rounds, a line void, a split and a shift handover

<div dir="rtl">رحلة صالة كاملة: جولتين للمطبخ، إلغاء صنف بموافقة مدير، تقسيم الشيك، وتسليم وردية</div>

### J-R1 · step 1

| | |
|---|---|
| Who / where | `demo-manager-1` on `DEMO-ADMIN-1` · setup (no L1 screen: S-ADMIN is L2; use the API client of NP-R-13) |
| Do | Create table "13" (area Terrace, capacity 4). Then try to create a table named "7". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">أنشئ ترابيزة "13" (منطقة Terrace، سعة 4). بعدها حاول تنشئ ترابيزة اسمها "7".</div> |
| Expect on screen | Table 13 appears in the table list. The second attempt is refused: the name is taken (table 7 is provisioned). |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">ترابيزة 13 تظهر في القائمة. المحاولة التانية تترفض لأن الاسم مستخدم (ترابيزة 7 موجودة من التجهيز).</div> |
| Note | The journey says "creates table 7"; table 7 is provisioned (NP-D-11), so this step proves Table.Create with 13 and the per-branch name guard with 7. |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Table.Create` | tables/operation/Table.Create@2 | POST /tables | demo-manager-1 · `table:upsert` ✓ | 201, table 13 ACTIVE, version 1 |
| `Table.Create` | tables/operation/Table.Create@2 | POST /tables | demo-manager-1 · `table:upsert` ✓ | second call rejected; nothing written<br>`TABLE_NAME_TAKEN` 409 `FIX_AND_RESUBMIT` |
| `Table.List` | tables/operation/Table.List@1 | GET /tables | demo-manager-1 · `table:read` ✓ | 13 tables, including 7 and 13 |

### J-R1 · step 2

| | |
|---|---|
| Who / where | `demo-manager-1` on `DEMO-ADMIN-1` · setup (no L1 screen: S-ADMIN is L2; use the API client of NP-R-13) |
| Do | Create station "PASTRY". Create a routing rule: priority 5, match product Om Ali, station PASTRY. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">أنشئ محطة "PASTRY". أنشئ قاعدة توجيه: أولوية 5، الصنف أم علي، المحطة PASTRY.</div> |
| Expect on screen | The rule list shows priority 5 (Om Ali → PASTRY) first, then the provisioned rules 10…50 and the catch-all 1000 → GRILL. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">قائمة القواعد تبدأ بأولوية 5 (أم علي ← PASTRY)، بعدها القواعد المجهزة 10 لـ 50، وفي الآخر القاعدة العامة 1000 ← GRILL.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `KitchenStation.Create` | kitchen_routing/operation/KitchenStation.Create@2 | POST /kitchen/stations | demo-manager-1 · `kitchen:configure` ✓ | 201, station PASTRY ACTIVE |
| `RoutingRule.Create` | kitchen_routing/operation/RoutingRule.Create@2 | POST /kitchen/routing-rules | demo-manager-1 · `kitchen:configure` ✓ | 201, rule priority 5, match {productId: Om Ali} |
| `RoutingRule.List` | kitchen_routing/operation/RoutingRule.List@1 | GET /kitchen/routing-rules | demo-manager-1 · `kitchen:read` ✓ | ascending priority; ties (none here) by id (E-30) |

### J-R1 · step 3

| | |
|---|---|
| Who / where | `demo-cashier-a` on `DEMO-CASH-1` · S-LOGIN → S22 |
| Do | Log in as demo-cashier-a (credential from the environment, never written in the script). Open the shift with opening float 500.00. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">سجّل دخول بـ demo-cashier-a (كلمة السر من البيئة، ما تتكتبش في السكريبت). افتح الوردية برصيد افتتاحي 500.00.</div> |
| Expect on screen | Before opening: "no open shift". After: shift OPEN on DEMO-CASH-1; the float shown is the server value 500.00. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">قبل الفتح: "مفيش وردية مفتوحة". بعد الفتح: الوردية OPEN على DEMO-CASH-1، والرصيد المعروض هو قيمة السيرفر 500.00.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Auth.Login` | canonical | POST /auth/login | demo-cashier-a · PUBLIC | authenticated; terminal DEMO-CASH-1 |
| `Access.Me` | canonical | GET /auth/me | demo-cashier-a · AUTHENTICATED | Demo Cashier, Demo Main Branch |
| `Session.Current` | canonical | GET /sessions/current | demo-cashier-a · `session:read` ✓ | 200 {status: NO_OPEN_SESSION} (accepted runtime, sessions/queries.ts): the "open shift" state, not an error |
| `Session.Open` | canonical | POST /sessions | demo-cashier-a · `session:open` ✓ | 201, session OPEN, openingFloat 500.0000 |

### J-R1 · step 4

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S-LOGIN → S25 → S12 |
| Do | Log in as demo-waiter-1 on the floor tablet. On the floor map tap table 7, then "Open table". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">سجّل دخول بـ demo-waiter-1 على تابلت الصالة. في خريطة الصالة اضغط ترابيزة 7، بعدها "فتح الترابيزة".</div> |
| Expect on screen | Table 7 turns occupied. No shift or drawer is asked for on this tablet. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">ترابيزة 7 تبقى مشغولة. التابلت ما يطلبش وردية ولا درج.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Auth.Login` | canonical | POST /auth/login | demo-waiter-1 · PUBLIC | authenticated; terminal DEMO-FLOOR-1 (no drawer) |
| `Table.List` | tables/operation/Table.List@1 | GET /tables | demo-waiter-1 · `table:read` ✓ | tables of the branch |
| `TableVisit.List` | tables/operation/TableVisit.List@1 | GET /table-visits | demo-waiter-1 · `table:read` ✓ | no open visit on 7 |
| `TableVisit.Open` | tables/operation/TableVisit.Open@2 | POST /tables/{tableId}/visits | demo-waiter-1 · `table:assign` ✓ | 201, visit OPEN on table 7 |

### J-R1 · step 5

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S12 → S15 |
| Do | Tap "New check". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">اضغط "شيك جديد".</div> |
| Expect on screen | Order entry opens with an empty cart and the server's check number. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">شاشة الطلب تفتح بسلة فاضية ورقم الشيك من السيرفر.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Create` | canonical<br>orders/change_request/Order.Create@3 | POST /orders | demo-waiter-1 · `order:create` ✓ | 201, DINE_IN, DRAFT, visitId = table 7 visit, sessionId null (floor check: FloorIntakePolicy DINE_IN = FLOOR_WITHOUT_DRAWER) |
| `tables.AssertVisitOpen` | tables/operation/tables.AssertVisitOpen@1 | internal (no HTTP) | demo-waiter-1 · internal | visit OPEN (inside the same transaction) |

### J-R1 · step 6

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S15 |
| Do | Browse the menu. Add Grilled kofta ×2 (Doneness: Medium), Hummus ×1, Orange juice ×2 (Size: Large). Look at Kunafa. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">تصفح المنيو. ضيف كفتة مشوية ×2 (الاستواء: Medium)، حمص ×1، عصير برتقال ×2 (الحجم: Large). بص على الكنافة.</div> |
| Expect on screen | 5 categories in Arabic and English. Every tile price comes from a server quote. Kunafa shows "unavailable" and cannot be added. The size dialog shows "+0.00" / "+10.00" as server strings; the line price is a server re-quote, never a local sum. Cart lines show the captured prices from the order. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">5 أقسام بالعربي والإنجليزي. كل سعر على الأصناف جاي من تسعيرة السيرفر. الكنافة مكتوب عليها "غير متاح" وما ينفعش تتضاف. شاشة الحجم بتعرض "+0.00" و"+10.00" زي ما السيرفر بعتها، وسعر السطر تسعيرة جديدة من السيرفر مش جمع على الجهاز. سطور السلة بتعرض الأسعار المسجلة على الطلب.</div> |
| Note | Tester reference from the demo price list (for checking only; the UI never computes it): kofta 220.00, hummus 60.00, orange juice Large 60.00 (50.00 + 10.00). |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Category.List` | catalog/operation/Category.List@2 | GET /categories | demo-waiter-1 · `catalog:read` ✓ | 5 active categories |
| `Catalog.Search` | catalog/operation/Catalog.Search@2 | GET /catalog/search | demo-waiter-1 · `catalog:read` ✓ | products of the category |
| `ModifierGroup.List` | catalog/operation/ModifierGroup.List@1 | GET /modifier-groups | demo-waiter-1 · `catalog:read` ✓ | Doneness (SINGLE, min 1), Size (SINGLE, min 1) |
| `Pricing.QuoteItem` | canonical | POST /pricing/items/{productId}/quote | demo-waiter-1 · `catalog:read` ✓ | one quote per visible tile and per dialog change; Kunafa rejected<br>`PRODUCT_UNAVAILABLE` 409 `FINAL_NEW_INTENT_ONLY` |
| `Order.AddLines` | canonical<br>orders/change_request/Order.AddLines@1 | POST /orders/{orderId}/lines | demo-waiter-1 · `order:addlines` ✓ | 200, three lines with captured prices |
| `Order.Get` | canonical | GET /orders/{orderId} | demo-waiter-1 · `order:read` ✓ | the check with its lines and version |

### J-R1 · step 7

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S15 |
| Do | Tap "Send to kitchen". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">اضغط "إرسال للمطبخ".</div> |
| Expect on screen | Round 1. The three lines show as sent; their edit and remove controls are disabled. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الجولة 1. التلات سطور بقوا "اتبعتوا"، وأزرار التعديل والحذف عليهم مقفولة.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Fire` | orders/operation/Order.Fire@4 | POST /orders/{orderId}/fire | demo-waiter-1 · `order:fire` ✓ | 200, fireRound 1, three lines firedAt set (expectedVersion from Order.Get) |

### J-R1 · step 8

| | |
|---|---|
| Who / where | `demo-chef-1` on `DEMO-KDS-1` · S28 |
| Do | Log in as demo-chef-1. Open the GRILL board, then COLD, then BAR. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">سجّل دخول بـ demo-chef-1. افتح شاشة GRILL، بعدها COLD، بعدها BAR.</div> |
| Expect on screen | GRILL: round 1, Grilled kofta ×2 Medium. COLD: Hummus ×1. BAR: Orange juice ×2 Large. One ticket per station for round 1. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">GRILL: الجولة 1، كفتة مشوية ×2 Medium. COLD: حمص ×1. BAR: عصير برتقال ×2 Large. تذكرة واحدة لكل محطة في الجولة 1.</div> |
| Note | Tickets are created by the worker after the Fire commit; allow the worker poll interval before judging. |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `kitchen.fire-round` | canonical<br>kitchen/change_request/kitchen.fire-round@4 | internal (no HTTP) | demo-chef-1 · internal | consumes OrderFired once; routes by rule (mains 50 → GRILL, starters 30 → COLD, cold 20 → BAR) |
| `orders.FiredRoundLines` | orders/operation/orders.FiredRoundLines@2 | internal (no HTTP) | demo-chef-1 · internal | the round-1 lines |
| `KitchenStation.List` | kitchen_routing/operation/KitchenStation.List@1 | GET /kitchen/stations | demo-chef-1 · `kitchen:read` ✓ | GRILL, COLD, BAR, PASTRY |
| `Kitchen.Board` | kitchen/operation/Kitchen.Board@1 | GET /kitchen/board | demo-chef-1 · `kitchen:read` ✓ | QUEUED tickets per station |

### J-R1 · step 9

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S15 |
| Do | Add Om Ali ×1, Tea ×2 (Size: Regular) and Green salad ×1. Change Tea to 3. Remove Green salad. Try to change the kofta quantity. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">ضيف أم علي ×1، شاي ×2 (الحجم: Regular)، سلطة خضراء ×1. غيّر الشاي لـ 3. امسح السلطة. حاول تغيّر كمية الكفتة.</div> |
| Expect on screen | Om Ali ×1 and Tea ×3 remain unsent. The salad is gone. The kofta line cannot be edited (sent). |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">أم علي ×1 وشاي ×3 لسه ما اتبعتوش. السلطة اتشالت. سطر الكفتة ما ينفعش يتعدل لأنه اتبعت.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.AddLines` | canonical<br>orders/change_request/Order.AddLines@1 | POST /orders/{orderId}/lines | demo-waiter-1 · `order:addlines` ✓ | 200, three new unfired lines |
| `Order.UpdateLine` | canonical<br>orders/change_request/Order.UpdateLine@1 | PATCH /orders/{orderId}/lines/{lineId} | demo-waiter-1 · `order:updateline` ✓ | 200, tea quantity 3 |
| `Order.RemoveLine` | canonical<br>orders/change_request/Order.RemoveLine@1 | DELETE /orders/{orderId}/lines/{lineId} | demo-waiter-1 · `order:removeline` ✓ | 200, salad removed (unfired only) |
| `Order.UpdateLine` | canonical<br>orders/change_request/Order.UpdateLine@1 | PATCH /orders/{orderId}/lines/{lineId} | demo-waiter-1 · `order:updateline` ✓ | only if forced through the API: rejected, nothing written<br>`LINE_ALREADY_FIRED` 409 `FINAL_NEW_INTENT_ONLY` |

### J-R1 · step 10

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S15 (then S28) |
| Do | Tap "Send to kitchen" again. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">اضغط "إرسال للمطبخ" تاني.</div> |
| Expect on screen | Round 2 contains only Om Ali ×1 and Tea ×3. On the KDS: PASTRY shows Om Ali (rule 5 wins over desserts 40), BAR shows Tea ×3; round-1 tickets are unchanged. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الجولة 2 فيها أم علي ×1 وشاي ×3 بس. في المطبخ: PASTRY تعرض أم علي (قاعدة 5 بتغلب قاعدة الحلويات 40)، وBAR تعرض شاي ×3. تذاكر الجولة 1 زي ما هي.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Fire` | orders/operation/Order.Fire@4 | POST /orders/{orderId}/fire | demo-waiter-1 · `order:fire` ✓ | 200, fireRound 2, only the new lines |

### J-R1 · step 11

| | |
|---|---|
| Who / where | `demo-chef-1` on `DEMO-KDS-1` · S28 |
| Do | On GRILL, start the round-1 kofta ticket. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">في GRILL، ابدأ تذكرة الكفتة بتاعة الجولة 1.</div> |
| Expect on screen | The ticket moves from QUEUED to STARTED. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">التذكرة بتتحول من QUEUED لـ STARTED.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Kitchen.AdvanceTicket` | kitchen/operation/Kitchen.AdvanceTicket@1 | POST /kitchen/tickets/{ticketId}/advance | demo-chef-1 · `kitchen:advanceticket` ✓ | 200, QUEUED → STARTED (forward transitions only, CAS) |

### J-R1 · step 12

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S15 → S-VOID |
| Do | Select the sent Hummus line, tap "Void", choose reason WRONG_ITEM. When the approval dialog opens, demo-manager-1 picks their name and enters their PIN on the tablet. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">اختار سطر الحمص اللي اتبعت، اضغط "إلغاء"، واختار السبب WRONG_ITEM. لما شاشة الموافقة تفتح، demo-manager-1 يختار اسمه ويكتب الـ PIN بتاعه على التابلت.</div> |
| Expect on screen | The approval dialog appears without an error banner. After approval the Hummus line is shown voided and the server total no longer includes it. COLD shows the hummus line cancelled. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">شاشة الموافقة تظهر من غير رسالة خطأ. بعد الموافقة سطر الحمص يظهر ملغي، والإجمالي من السيرفر ما بقاش فيه. محطة COLD تعرض سطر الحمص ملغي.</div> |
| Approver | `demo-manager-1` · `approve:line_void` ✓ (not the requester) |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.VoidLine` | orders/operation/Order.VoidLine@5 | POST /orders/{orderId}/lines/{lineId}/void | demo-waiter-1 · `order:voidline` ✓ | first call without a grant: approval needed; nothing written<br>`APPROVAL_REQUIRED` 403 `APPROVAL_FLOW_SAME_ID` |
| `Approval.Grant` | canonical<br>approvals/change_request/Approval.Grant@3 | POST /approvals | demo-waiter-1 · `approval:grant` ✓ | 201, grant bound to {order, line, version, WRONG_ITEM, line amount}, expires per ApprovalTtlPolicy (120 s) |
| `Order.VoidLine` | orders/operation/Order.VoidLine@5 | POST /orders/{orderId}/lines/{lineId}/void | demo-waiter-1 · `order:voidline` ✓ | same X-Command-Id resubmitted with approvalGrantId: 200, line VOIDED, grant consumed |
| `kitchen.order-ended` | canonical<br>kitchen/change_request/kitchen.order-ended@1 | internal (no HTTP) | demo-waiter-1 · internal | OrderLineVoided: the COLD ticket line becomes CANCELLED (not started) |

### J-R1 · step 13

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S-SPLIT |
| Do | Open "Split". Create a second check on table 7. Move Orange juice ×2 and Tea ×3 to it. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">افتح "تقسيم". اعمل شيك تاني على ترابيزة 7. انقل عصير البرتقال ×2 والشاي ×3 ليه.</div> |
| Expect on screen | Table 7 has two checks. Check 1: kofta ×2, hummus (voided), Om Ali. Check 2: orange juice ×2, tea ×3. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">ترابيزة 7 عليها شيكين. الشيك 1: كفتة ×2، حمص (ملغي)، أم علي. الشيك 2: عصير برتقال ×2، شاي ×3.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Create` | canonical<br>orders/change_request/Order.Create@3 | POST /orders | demo-waiter-1 · `order:create` ✓ | 201, second floor check on the same visit (CheckCompositionPolicy VISIT_MULTI_CHECK) |
| `Order.MoveLines` | orders/operation/Order.MoveLines@4 | POST /orders/{orderId}/lines/move | demo-waiter-1 · `order:updateline` ✓ | 200, both orders updated with CAS; fire rounds kept |
| `Order.Find` | canonical | GET /orders | demo-waiter-1 · `order:read` ✓ | two checks for the visit |

### J-R1 · step 14

| | |
|---|---|
| Who / where | `demo-cashier-a` on `DEMO-CASH-1` · S16 |
| Do | On the cashier station open table 7, choose check 2, tap "Confirm". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">على الكاشير افتح ترابيزة 7، اختار الشيك 2، واضغط "تأكيد".</div> |
| Expect on screen | Check 2 CONFIRMED. Subtotal, tax and total are shown exactly as returned by the server. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الشيك 2 اتأكد (CONFIRMED). المجموع والضريبة والإجمالي معروضين زي ما السيرفر رجّعهم بالظبط.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Find` | canonical | GET /orders | demo-cashier-a · `order:read` ✓ | the visit's checks |
| `Order.Confirm` | canonical<br>orders/change_request/Order.Confirm@3 | POST /orders/{orderId}/confirm | demo-cashier-a · `order:confirm` ✓ | 200, CONFIRMED, server totals |

### J-R1 · step 15

| | |
|---|---|
| Who / where | `demo-cashier-a` on `DEMO-CASH-1` · S16 |
| Do | Pay check 2 in cash: type the received amount (any amount at or above the total, e.g. 300.00). |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">ادفع الشيك 2 كاش: اكتب المبلغ المستلم (أي مبلغ يساوي الإجمالي أو أكتر، مثلًا 300.00).</div> |
| Expect on screen | The change shown is the server's change value. The settlement shows nothing remaining. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الباقي المعروض هو قيمة الباقي من السيرفر. التسوية بتقول إن مفيش مبلغ متبقي.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Payment.GetSettlement` | canonical | GET /orders/{orderId}/settlement | demo-cashier-a · `payment:read` ✓ | remaining amount (the cash tender amount is this server value) |
| `Payment.Capture` | canonical<br>payments/change_request/Payment.Capture@1 | POST /orders/{orderId}/payments | demo-cashier-a · `payment:capture` ✓ | 201, CASH capture; tendered and change computed by the server |
| `Payment.GetSettlement` | canonical | GET /orders/{orderId}/settlement | demo-cashier-a · `payment:read` ✓ | settled |

### J-R1 · step 16

| | |
|---|---|
| Who / where | `demo-cashier-a` on `DEMO-CASH-1` · S16 |
| Do | Tap "Complete". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">اضغط "إنهاء".</div> |
| Expect on screen | Check 2 COMPLETED. Table 7 stays occupied because check 1 is still open. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الشيك 2 خلص (COMPLETED). ترابيزة 7 لسه مشغولة لأن الشيك 1 مفتوح.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Complete` | canonical | POST /orders/{orderId}/complete | demo-cashier-a · `order:complete` ✓ | 200, COMPLETED |

### J-R1 · step 17

| | |
|---|---|
| Who / where | `demo-cashier-a` on `DEMO-CASH-1` · S22 |
| Do | Open the X report. Then close the shift: count the drawer and type the counted amount (500.00 float + the check 2 cash amount). |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">افتح تقرير X. بعدها اقفل الوردية: عِد الدرج واكتب المبلغ المعدود (500.00 رصيد افتتاحي + كاش الشيك 2).</div> |
| Expect on screen | X: a CASH line equal to check 2's capture and no card line; expected cash is hidden until the count (blind close). The close succeeds while check 1 is still open; variance 0.00 from the server. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">تقرير X: سطر كاش بقيمة دفع الشيك 2 ومفيش سطر كارت، والكاش المتوقع مخفي لحد العد (إقفال أعمى). الإقفال بينجح والشيك 1 لسه مفتوح، والفرق 0.00 من السيرفر.</div> |
| Note | A counted amount that differs triggers the SESSION_VARIANCE approval (threshold 0.00); that path is not part of this walkthrough. |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Session.XReport` | canonical | GET /sessions/{sessionId}/x-report | demo-cashier-a · `session:xreport` ✓ | tenderBreakdown CASH only; expectedCash absent (BlindClosePolicy default) |
| `Session.Close` | canonical<br>sessions/change_request/Session.Close@1 | POST /sessions/{sessionId}/close | demo-cashier-a · `session:close` ✓ | 200, CLOSED, variance 0.00; the floor check (sessionId null) does not block (docs/15 §5) |

### J-R1 · step 18

| | |
|---|---|
| Who / where | `demo-cashier-b` on `DEMO-CASH-1` · S-LOGIN → S22 |
| Do | demo-cashier-a logs out. demo-cashier-b logs in and opens a shift with float 500.00. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">demo-cashier-a يعمل تسجيل خروج. demo-cashier-b يسجّل دخول ويفتح وردية برصيد 500.00.</div> |
| Expect on screen | "No open shift", then a new OPEN shift for cashier B. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">"مفيش وردية مفتوحة"، بعدها وردية جديدة مفتوحة لكاشير B.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Auth.Logout` | canonical | POST /auth/logout | demo-cashier-a · AUTHENTICATED | cashier A signed out |
| `Auth.Login` | canonical | POST /auth/login | demo-cashier-b · PUBLIC | cashier B on DEMO-CASH-1 |
| `Session.Current` | canonical | GET /sessions/current | demo-cashier-b · `session:read` ✓ | 200 {status: NO_OPEN_SESSION} |
| `Session.Open` | canonical | POST /sessions | demo-cashier-b · `session:open` ✓ | 201, OPEN, openingFloat 500.0000 |

### J-R1 · step 19

| | |
|---|---|
| Who / where | `demo-cashier-b` on `DEMO-CASH-1` · S16 |
| Do | Open table 7, choose check 1, tap "Confirm". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">افتح ترابيزة 7، اختار الشيك 1، واضغط "تأكيد".</div> |
| Expect on screen | Check 1 CONFIRMED by cashier B. The voided hummus is not in the server total. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الشيك 1 اتأكد من كاشير B. الحمص الملغي مش داخل في إجمالي السيرفر.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Find` | canonical | GET /orders | demo-cashier-b · `order:read` ✓ | the open check of the visit |
| `Order.Confirm` | canonical<br>orders/change_request/Order.Confirm@3 | POST /orders/{orderId}/confirm | demo-cashier-b · `order:confirm` ✓ | 200, CONFIRMED, server totals |

### J-R1 · step 20

| | |
|---|---|
| Who / where | `demo-cashier-b` on `DEMO-CASH-1` · S16 |
| Do | Pay 200.00 in cash (received 200.00). For the rest choose Card and type reference DEMO-REF-0001. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">ادفع 200.00 كاش (المستلم 200.00). والباقي اختار كارت واكتب المرجع DEMO-REF-0001.</div> |
| Expect on screen | Two payments: cash 200.00 and card "recorded, ref DEMO-REF-0001" for the remaining amount the server returned. Nothing remaining. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">دفعتين: كاش 200.00 وكارت "مسجّل، مرجع DEMO-REF-0001" بالمبلغ المتبقي اللي السيرفر رجّعه. مفيش متبقي.</div> |
| Note | Split tender is allowed by default (SplitTenderPolicy true; TenderMethodPolicy enables CASH and CARD). |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Payment.Capture` | canonical<br>payments/change_request/Payment.Capture@1 | POST /orders/{orderId}/payments | demo-cashier-b · `payment:capture` ✓ | 201, CASH 200.0000 |
| `Payment.GetSettlement` | canonical | GET /orders/{orderId}/settlement | demo-cashier-b · `payment:read` ✓ | remaining (server value used as the card amount) |
| `Payment.Capture` | canonical<br>payments/change_request/Payment.Capture@1 | POST /orders/{orderId}/payments | demo-cashier-b · `payment:capture` ✓ | 201, CARD with tenderReference (recorded, no provider) |

### J-R1 · step 21

| | |
|---|---|
| Who / where | `demo-cashier-b` on `DEMO-CASH-1` · S16 |
| Do | Tap "Complete". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">اضغط "إنهاء".</div> |
| Expect on screen | Check 1 COMPLETED. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الشيك 1 خلص (COMPLETED).</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Complete` | canonical | POST /orders/{orderId}/complete | demo-cashier-b · `order:complete` ✓ | 200, COMPLETED |

### J-R1 · step 22

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S25 |
| Do | On the floor map open table 7 and tap "Close table". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">في خريطة الصالة افتح ترابيزة 7 واضغط "قفل الترابيزة".</div> |
| Expect on screen | Table 7 is free again. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">ترابيزة 7 بقت فاضية.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `TableVisit.Close` | tables/operation/TableVisit.Close@1 | POST /table-visits/{visitId}/close | demo-waiter-1 · `table:release` ✓ | 200, visit CLOSED (closing a visit never completes or voids a check, E-31) |

### J-R1 · step 23

| | |
|---|---|
| Who / where | `demo-cashier-b` on `DEMO-CASH-1` · S22 |
| Do | Cashier B closes the shift: count the drawer and type 700.00 (500.00 float + 200.00 cash; the card is not in the drawer). Then demo-manager-1 opens the Z report of this shift on DEMO-ADMIN-1. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">كاشير B يقفل الوردية: يعد الدرج ويكتب 700.00 (500.00 رصيد + 200.00 كاش؛ الكارت مش في الدرج). بعدها demo-manager-1 يفتح تقرير Z للوردية دي على DEMO-ADMIN-1.</div> |
| Expect on screen | Close succeeds with variance 0.00. Z shows CASH 200.00 and CARD (recorded, ref DEMO-REF-0001) as separate lines; expected cash excludes the card. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الإقفال ينجح والفرق 0.00. تقرير Z يعرض كاش 200.00 وكارت (مسجّل، مرجع DEMO-REF-0001) في سطرين منفصلين، والكاش المتوقع ما فيهوش الكارت.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Session.Close` | canonical<br>sessions/change_request/Session.Close@1 | POST /sessions/{sessionId}/close | demo-cashier-b · `session:close` ✓ | 200, CLOSED, variance 0.00 |
| `Session.ZReport` | canonical | GET /sessions/{sessionId}/z-report | demo-manager-1 · `session:zreport` ✓ | immutable close snapshot; cash and card separate (docs/15) |

## J-R2: Whole-check void after sending, unpaid

<div dir="rtl">إلغاء شيك كامل بعد ما اتبعت للمطبخ ومن غير دفع</div>

### J-R2 · step 1

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S25 → S15 (cashier: S22, S16) |
| Do | demo-cashier-a opens a new shift on DEMO-CASH-1 (float 500.00). The waiter opens table 3, creates a check, adds Mixed grill ×1 (Well done) and sends it. The cashier confirms the check. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">demo-cashier-a يفتح وردية جديدة على DEMO-CASH-1 (رصيد 500.00). الويتر يفتح ترابيزة 3، يعمل شيك، يضيف مشويات مشكلة ×1 (Well done) ويبعتها. الكاشير يأكد الشيك.</div> |
| Expect on screen | Check CONFIRMED and unpaid. GRILL shows the mixed grill ticket. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الشيك متأكد ومش مدفوع. GRILL تعرض تذكرة المشويات.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Session.Open` | canonical | POST /sessions | demo-cashier-a · `session:open` ✓ | 201, OPEN |
| `TableVisit.Open` | tables/operation/TableVisit.Open@2 | POST /tables/{tableId}/visits | demo-waiter-1 · `table:assign` ✓ | 201, visit on table 3 |
| `Order.Create` | canonical<br>orders/change_request/Order.Create@3 | POST /orders | demo-waiter-1 · `order:create` ✓ | 201, floor check |
| `Order.AddLines` | canonical<br>orders/change_request/Order.AddLines@1 | POST /orders/{orderId}/lines | demo-waiter-1 · `order:addlines` ✓ | 200 |
| `Order.Fire` | orders/operation/Order.Fire@4 | POST /orders/{orderId}/fire | demo-waiter-1 · `order:fire` ✓ | 200, round 1 |
| `Order.Confirm` | canonical<br>orders/change_request/Order.Confirm@3 | POST /orders/{orderId}/confirm | demo-cashier-a · `order:confirm` ✓ | 200, CONFIRMED |

### J-R2 · step 2

| | |
|---|---|
| Who / where | `demo-manager-1` on `DEMO-ADMIN-1` · S-VOID |
| Do | The guests leave. demo-manager-1 opens the check, taps "Void check", chooses CUSTOMER_LEFT and writes a note. demo-manager-2 approves with their own PIN. Then the waiter closes table 3. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">الزباين مشيوا. demo-manager-1 يفتح الشيك، يضغط "إلغاء الشيك"، يختار CUSTOMER_LEFT ويكتب ملاحظة. demo-manager-2 يوافق بالـ PIN بتاعه. بعدها الويتر يقفل ترابيزة 3.</div> |
| Expect on screen | The check is VOIDED. Its lines and totals stay exactly as they were (history); no money moves. The GRILL ticket is cancelled. Table 3 is free. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الشيك اتلغى (VOIDED). السطور والإجمالي زي ما هم بالظبط (سجل تاريخي)، ومفيش فلوس اتحركت. تذكرة GRILL اتلغت. ترابيزة 3 فاضية.</div> |
| Approver | `demo-manager-2` · `approve:order_void` ✓ (not the requester) |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Get` | canonical | GET /orders/{orderId} | demo-manager-1 · `order:read` ✓ | the confirmed check |
| `Order.Void` | orders/operation/Order.Void@3 | POST /orders/{orderId}/void | demo-manager-1 · `order:void` ✓ | first call: approval needed; nothing written<br>`APPROVAL_REQUIRED` 403 `APPROVAL_FLOW_SAME_ID` |
| `Approval.Grant` | canonical<br>approvals/change_request/Approval.Grant@3 | POST /approvals | demo-manager-1 · `approval:grant` ✓ | 201, ORDER_VOID grant by manager 2 (self-approval is denied: N5) |
| `Order.Void` | orders/operation/Order.Void@3 | POST /orders/{orderId}/void | demo-manager-1 · `order:void` ✓ | same X-Command-Id with approvalGrantId: 200, VOIDED, snapshot unchanged |
| `kitchen.order-ended` | canonical<br>kitchen/change_request/kitchen.order-ended@1 | internal (no HTTP) | demo-manager-1 · internal | OrderVoided: non-completed tickets CANCELLED |
| `TableVisit.Close` | tables/operation/TableVisit.Close@1 | POST /table-visits/{visitId}/close | demo-waiter-1 · `table:release` ✓ | 200, CLOSED |

## J-R3: Login context, floor and kitchen administration, table transfer

<div dir="rtl">الدخول والسياق، إدارة الصالة والمطبخ، ونقل ترابيزة</div>

### J-R3 · step 1

| | |
|---|---|
| Who / where | `demo-cashier-a` on `DEMO-CASH-1` · S-LOGIN |
| Do | Log in as demo-cashier-a. Read the header (user, branch, terminal, shift). Log out, then try any action from the same page. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">سجّل دخول بـ demo-cashier-a. اقرا الهيدر (المستخدم، الفرع، الجهاز، الوردية). اعمل تسجيل خروج، وبعدها جرّب أي حركة من نفس الصفحة.</div> |
| Expect on screen | The header matches the server context. After logout every call is refused and the app returns to the login screen as the same user. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الهيدر مطابق لسياق السيرفر. بعد الخروج أي طلب بيترفض والتطبيق يرجع لشاشة الدخول لنفس المستخدم.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Auth.Login` | canonical | POST /auth/login | demo-cashier-a · PUBLIC | authenticated |
| `Access.Me` | canonical | GET /auth/me | demo-cashier-a · AUTHENTICATED | user, role, branch, terminal |
| `Session.Current` | canonical | GET /sessions/current | demo-cashier-a · `session:read` ✓ | 200 {status: OPEN, item} for the J-R2 shift, or {status: NO_OPEN_SESSION} |
| `Auth.Logout` | canonical | POST /auth/logout | demo-cashier-a · AUTHENTICATED | signed out |
| `Access.Me` | canonical | GET /auth/me | demo-cashier-a · AUTHENTICATED | after logout: refused<br>`UNAUTHENTICATED` 401 `REAUTHENTICATE_SAME_ACTOR` |

### J-R3 · step 2

| | |
|---|---|
| Who / where | `demo-manager-1` on `DEMO-ADMIN-1` · setup (no L1 screen: S-ADMIN is L2; use the API client of NP-R-13) |
| Do | demo-waiter-1 opens table 5. The manager sets table 13 to capacity 6, deactivates table 13, then tries to deactivate table 5. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">demo-waiter-1 يفتح ترابيزة 5. المدير يغيّر سعة ترابيزة 13 لـ 6، يقفّل ترابيزة 13 (غير نشطة)، وبعدها يحاول يقفّل ترابيزة 5.</div> |
| Expect on screen | Table 13 shows capacity 6, then disappears from the floor map (inactive). Deactivating table 5 is refused because it is occupied. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">ترابيزة 13 سعتها بقت 6، وبعدها اختفت من خريطة الصالة (غير نشطة). تقفيل ترابيزة 5 بيترفض لأنها مشغولة.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `TableVisit.Open` | tables/operation/TableVisit.Open@2 | POST /tables/{tableId}/visits | demo-waiter-1 · `table:assign` ✓ | 201, visit on table 5 |
| `Table.Configure` | tables/operation/Table.Configure@2 | PUT /tables/{tableId} | demo-manager-1 · `table:upsert` ✓ | 200, capacity 6 (CAS) |
| `Table.SetActive` | tables/operation/Table.SetActive@1 | POST /tables/{tableId}/active | demo-manager-1 · `table:upsert` ✓ | 200, table 13 inactive |
| `Table.SetActive` | tables/operation/Table.SetActive@1 | POST /tables/{tableId}/active | demo-manager-1 · `table:upsert` ✓ | table 5: rejected, nothing written<br>`TABLE_OCCUPIED` 409 `FINAL_NEW_INTENT_ONLY` |
| `Table.List` | tables/operation/Table.List@1 | GET /tables | demo-manager-1 · `table:read` ✓ | active and inactive tables |
| `TableVisit.List` | tables/operation/TableVisit.List@1 | GET /table-visits | demo-manager-1 · `table:read` ✓ | open visits (table 5) |

### J-R3 · step 3

| | |
|---|---|
| Who / where | `demo-manager-1` on `DEMO-ADMIN-1` · setup (no L1 screen: S-ADMIN is L2; use the API client of NP-R-13) |
| Do | Rename station PASTRY to "DESSERT BAR". Change the Om Ali rule from priority 5 to 45. Repeat the rule change with the old version. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">غيّر اسم محطة PASTRY لـ "DESSERT BAR". غيّر أولوية قاعدة أم علي من 5 لـ 45. كرّر تعديل القاعدة بالنسخة القديمة.</div> |
| Expect on screen | The station is renamed. The rule list now puts desserts (40) before Om Ali (45), so Om Ali routes to COLD from the next round. The stale repeat is refused and the screen reloads. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">المحطة اتغيّر اسمها. القائمة بقت فيها الحلويات (40) قبل أم علي (45)، فأم علي هتروح COLD من الجولة الجاية. التكرار بالنسخة القديمة بيترفض والشاشة بتعمل تحديث.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `KitchenStation.Configure` | kitchen_routing/operation/KitchenStation.Configure@2 | PUT /kitchen/stations/{stationId} | demo-manager-1 · `kitchen:configure` ✓ | 200, renamed |
| `RoutingRule.Configure` | kitchen_routing/operation/RoutingRule.Configure@2 | PUT /kitchen/routing-rules/{ruleId} | demo-manager-1 · `kitchen:configure` ✓ | 200, priority 45 |
| `RoutingRule.Configure` | kitchen_routing/operation/RoutingRule.Configure@2 | PUT /kitchen/routing-rules/{ruleId} | demo-manager-1 · `kitchen:configure` ✓ | stale expectedVersion: rejected<br>`CONCURRENCY_CONFLICT` 409 `REFRESH_THEN_DECIDE` |
| `RoutingRule.List` | kitchen_routing/operation/RoutingRule.List@1 | GET /kitchen/routing-rules | demo-manager-1 · `kitchen:read` ✓ | new order |

### J-R3 · step 4

| | |
|---|---|
| Who / where | `demo-waiter-1` on `DEMO-FLOOR-1` · S25 |
| Do | Move the party on table 5 to table 6. Then try to move it to table 13 (inactive), and to a table that is occupied. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">انقل الزباين من ترابيزة 5 لترابيزة 6. بعدها حاول تنقلهم لترابيزة 13 (غير نشطة)، ولترابيزة مشغولة.</div> |
| Expect on screen | The visit is now on table 6; table 5 is free; its checks follow the visit. Both other moves are refused. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">الزيارة بقت على ترابيزة 6، وترابيزة 5 فضيت، والشيكات ماشية مع الزيارة. النقلتين التانيين بيترفضوا.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `TableVisit.Transfer` | tables/operation/TableVisit.Transfer@1 | POST /table-visits/{visitId}/transfer | demo-waiter-1 · `table:transfer` ✓ | 200, visit moved 5 → 6 |
| `TableVisit.Transfer` | tables/operation/TableVisit.Transfer@1 | POST /table-visits/{visitId}/transfer | demo-waiter-1 · `table:transfer` ✓ | to table 13: rejected<br>`TABLE_INACTIVE` 409 `FIX_AND_RESUBMIT` |
| `TableVisit.Transfer` | tables/operation/TableVisit.Transfer@1 | POST /table-visits/{visitId}/transfer | demo-waiter-1 · `table:transfer` ✓ | to an occupied table: rejected<br>`TABLE_OCCUPIED` 409 `FINAL_NEW_INTENT_ONLY` |

## J-R4: Cash refund after payment, approved by another manager

<div dir="rtl">استرداد كاش بعد الدفع، بموافقة مدير تاني</div>

### J-R4 · step 1

| | |
|---|---|
| Who / where | `demo-manager-1` on `DEMO-CASH-1` · S16 (refund) |
| Do | A shift is open on DEMO-CASH-1 (J-R2 step 1). demo-manager-1 logs in there, opens J-R1 check 1 (completed) and opens "Refund". |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">فيه وردية مفتوحة على DEMO-CASH-1 (من J-R2 الخطوة 1). demo-manager-1 يسجّل دخول هناك، يفتح الشيك 1 بتاع J-R1 (خلصان) ويفتح "استرداد".</div> |
| Expect on screen | The refundable lines and amounts per payment are shown exactly as the server returns them; the UI never computes "remaining". |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">السطور والمبالغ القابلة للاسترداد لكل دفعة معروضة زي ما السيرفر رجّعها؛ الواجهة عمرها ما تحسب "المتبقي".</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Order.Find` | canonical | GET /orders | demo-manager-1 · `order:read` ✓ | completed check 1 |
| `Refund.Refundable` | canonical | GET /orders/{orderId}/refundable | demo-manager-1 · `refund:read` ✓ | per line and per capture refundable amounts |

### J-R4 · step 2

| | |
|---|---|
| Who / where | `demo-manager-1` on `DEMO-CASH-1` · S16 (refund) |
| Do | Refund Om Ali ×1 against the cash payment, reason QUALITY_ISSUE with a note. First try allocating it to the card payment. Then demo-manager-2 logs in on DEMO-CASH-1 and approves; the cash is paid out from the drawer. |
| <div dir="rtl">نفّذ</div> | <div dir="rtl">استرد أم علي ×1 من الدفعة الكاش، السبب QUALITY_ISSUE مع ملاحظة. الأول جرّب تحطه على دفعة الكارت. بعدها demo-manager-2 يسجّل دخول على DEMO-CASH-1 ويوافق، والكاش يطلع من الدرج.</div> |
| Expect on screen | The card allocation is refused (refunds are cash only in L1). The request becomes PENDING_APPROVAL, then APPROVED with the cash payout. The open shift's X report shows the refund separately. |
| <div dir="rtl">المتوقع</div> | <div dir="rtl">التحميل على الكارت بيترفض (الاسترداد كاش بس في L1). الطلب يبقى PENDING_APPROVAL، بعدها APPROVED مع صرف الكاش. تقرير X للوردية المفتوحة يعرض الاسترداد في سطر لوحده.</div> |

| Operation | Spec | HTTP | Actor · permission | Expected |
|---|---|---|---|---|
| `Refund.Request` | canonical | POST /orders/{orderId}/refund-requests | demo-manager-1 · `refund:request` ✓ | card allocation: rejected<br>`CROSS_TENDER_REFUND_DENIED` 409 `FINAL_NEW_INTENT_ONLY` |
| `Refund.Request` | canonical | POST /orders/{orderId}/refund-requests | demo-manager-1 · `refund:request` ✓ | 201, PENDING_APPROVAL, reason persisted |
| `Refund.Approve` | canonical | POST /refund-requests/{refundCaseId}/approve | demo-manager-2 · `refund:approve` ✓ | 200, approved under lock; CASH payout from the open session (if the server asks for a grant: APPROVAL_REQUIRED, REFUND_APPROVE, approver ≠ requester) |
| `Refund.Get` | canonical | GET /refund-requests/{refundCaseId} | demo-manager-1 · `refund:read` ✓ | the approved case with its payout |
| `Session.XReport` | canonical | GET /sessions/{sessionId}/x-report | demo-cashier-a · `session:xreport` ✓ | refundBreakdown shows the cash refund |

