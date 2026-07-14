-- 0125_service_master_contract_period_and_notice_spacing.sql
-- 業務委託基本契約書(service_master)テンプレを disk と同期し DB へ新版登録:
--   - 頭書き「契約期間」欄を CONTRACT_PERIOD_SUMMARY 駆動化。空欄時は
--     「契約締結日から1年間・自動更新(更新拒絶なき限り同条件で1年更新)」を既定表示。
--   - 第14条(契約期間、更新および中途解約)①に自動更新条項を追加し頭書き既定と整合。
--   - 頭書き通知先の受託者(乙)セルにクラウドサイン入力フォーム設置用の行間(class notice-contractor)。
--   本番 worker/search-api は TEMPLATE_SOURCE=db のため current version を新版へ貼替(冪等)。
--   disk: services/worker/templates/service_master.html と同一内容。field_schema は現行版を継承。

DO $sm_mig$
DECLARE
  tid INTEGER;
  cur_html TEXT;
  cur_schema JSONB;
  vid INTEGER;
BEGIN
  SELECT dt.id, v.html_source, v.field_schema
    INTO tid, cur_html, cur_schema
    FROM document_templates dt
    LEFT JOIN document_template_versions v ON v.id = dt.current_version_id
   WHERE dt.template_key = 'service_master';

  IF tid IS NULL THEN
    RAISE NOTICE '0125: service_master template not found, skipping';
    RETURN;
  END IF;

  IF cur_html IS NOT DISTINCT FROM $sm_html$<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>業務委託基本契約書</title>
    <style>
        @page {
            size: A4;
            margin: 18mm 20mm 22mm 25mm;
            @bottom-center {
                content: "- " counter(page) " -";
                font-size: 8.5pt;
                font-family: "Noto Serif CJK JP", "IPAMincho", serif;
            }
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: "Noto Serif CJK JP", "IPAMincho", "MS Mincho", serif;
            font-size: 10pt;
            line-height: 1.75;
            color: #000;
            background-color: #fff;
            margin: 0;
            padding: 0;
        }

        .contract-document {
            max-width: 210mm;
            margin: 0 auto;
            background-color: #fff;
            padding: 18mm 20mm 22mm 25mm;
            box-sizing: border-box;
        }

        /* ===== ドキュメントヘッダー ===== */
        .doc-header {
            display: flex;
            justify-content: flex-end;
            align-items: baseline;
            gap: 0.45em;
            margin-bottom: 0.5em;
            font-size: 8.5pt;
            color: #555;
            letter-spacing: 0.05em;
        }

        .doc-header .header-separator {
            color: #aaa;
        }

        /* ===== タイトル ===== */
        h1.contract-title {
            text-align: center;
            font-size: 14pt;
            font-weight: bold;
            letter-spacing: 0.35em;
            margin-bottom: 0.9em;
            text-decoration: underline;
            text-underline-offset: 0.22em;
        }

        h2 {
            font-size: 11pt;
            margin-top: 14px;
            margin-bottom: 6px;
            border-bottom: 1px solid #999;
            padding-bottom: 2px;
        }

        p {
            margin-bottom: 6px;
            text-align: justify;
        }

        ul, ol {
            padding-left: 18px;
            margin-bottom: 6px;
        }

        li { margin-bottom: 3px; }

        /* ===== 頭書き表 ===== */
        .tobogaki {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 1.15em;
            font-size: 9pt;
            line-height: 1.6;
            border-top: 1.5pt solid #1a1a1a;
            border-bottom: 1.5pt solid #1a1a1a;
        }

        .tobogaki th,
        .tobogaki td {
            border: none;
            border-bottom: 0.5pt solid #d8d8d8;
            padding: 0.45em 0.7em;
            vertical-align: top;
        }

        .tobogaki .sec-row td {
            padding-top: 0.9em;
            padding-bottom: 0.25em;
            border-bottom: 0.5pt solid #888;
            font-size: 7.5pt;
            font-weight: bold;
            letter-spacing: 0.25em;
            color: #555;
            text-transform: uppercase;
        }

        .tobogaki .col-item {
            width: 36%;
            font-weight: bold;
            color: #1a1a1a;
            padding-left: 0.5em;
        }

        .tobogaki .col-item .art-ref {
            font-size: 7.5pt;
            font-weight: normal;
            color: #777;
        }

        .tobogaki .col-item .sub-note {
            display: block;
            font-size: 7.5pt;
            font-weight: normal;
            color: #888;
            margin-top: 0.1em;
        }

        .tobogaki .col-value {
            width: 64%;
            word-break: break-all;
            overflow-wrap: break-word;
            color: #1a1a1a;
        }

        /* 受託者(乙)通知先セル: クラウドサイン入力フォーム設置のため行間を広めに確保。 */
        .tobogaki .col-value.notice-contractor {
            line-height: 2.3;
            padding-top: 0.5em;
            padding-bottom: 0.9em;
        }

        .tobogaki .special-cell {
            min-height: 2.5em;
            word-break: break-all;
            overflow-wrap: break-word;
            color: #1a1a1a;
            white-space: pre-wrap;
        }

        /* ===== 頭書き下部署名欄 ===== */
        .head-signature {
            margin: 0.2em 0 1.3em;
            page-break-inside: avoid;
            font-size: 9.2pt;
            line-height: 1.55;
        }

        .head-signature .sig-date {
            text-align: right;
            margin-bottom: 0.8em;
        }

        .head-signature .sig-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.2em;
        }

        .head-signature .sig-party {
            border-top: 1pt solid #1a1a1a;
            padding-top: 0.5em;
        }

        .head-signature .party-label {
            font-weight: bold;
            margin-bottom: 0.3em;
        }

        .head-signature .sig-name-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.8em;
            margin-top: 0.3em;
        }

        .head-signature .stamp-box {
            width: 52px;
            height: 52px;
            border: 1pt solid #1a1a1a;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 11pt;
            background-color: #fff;
            flex-shrink: 0;
        }

        .preamble {
            font-size: 9.5pt;
            text-indent: 1em;
            margin-bottom: 0.9em;
            line-height: 1.7;
        }

        .article-block > ol {
            list-style-type: none;
            counter-reset: item;
            padding-left: 0;
        }

        .article-block > ol > li {
            position: relative;
            padding-left: 1.5em;
            margin-bottom: 5px;
        }

        .article-block > ol > li::before {
            counter-increment: item;
            content: counter(item);
            position: absolute;
            left: 0.2em;
            top: 0;
            font-weight: normal;
        }

        .article-block > ol > li > ol {
            list-style-type: none;
            counter-reset: sub-item;
            padding-left: 0;
            margin-top: 5px;
        }

        .article-block > ol > li > ol > li {
            position: relative;
            padding-left: 2.5em;
            margin-bottom: 5px;
        }

        .article-block > ol > li > ol > li::before {
            counter-increment: sub-item;
            content: "(" counter(sub-item) ")";
            position: absolute;
            left: 0;
            top: 0;
        }

        .article-block { page-break-inside: auto; }
        .article-block h2 { page-break-after: avoid; }
        .no-break { page-break-inside: avoid; }

        @media print {
            body { background-color: #fff; padding: 0; }
            .contract-document {
                box-shadow: none;
                margin: 0;
                width: 100%;
                max-width: none;
                padding: 0;
            }
            h2 { page-break-after: avoid; margin-top: 10px; }
            .article-block { page-break-inside: auto; }
            .article-block > ol > li { page-break-inside: auto; }
            .head-signature, .tobogaki { page-break-inside: avoid; }
            p { orphans: 3; widows: 3; }
        }
    </style>
</head>
<body>

<div class="contract-document">

    <div class="doc-header">
        <span class="header-item">契約締結日：{{CONTRACT_DATE}}</span>
        <span class="header-separator">｜</span>
        <span class="header-item contract-no">契約番号：{{CONTRACT_NO}}</span>
    </div>

    <h1 class="contract-title">業務委託基本契約書</h1>

    <!-- ======================================================
         頭書き（当事者目録・契約条件一覧）
         ====================================================== -->
    <table class="tobogaki">
        <tbody>
            <!-- 当事者 -->
            <tr class="sec-row"><td colspan="2">当　事　者</td></tr>
            <tr>
                <td class="col-item">甲（委託者）</td>
                <td class="col-value">
                    {{PARTY_A_ADDRESS}}<br>
                    {{PARTY_A_NAME}}<br>
                    {{PARTY_A_REP}}
                </td>
            </tr>
            <tr>
                <td class="col-item">乙（受託者）</td>
                <td class="col-value">
                    {{VENDOR_ADDRESS}}<br>
                    {{VENDOR_NAME}}<br>
                    {{VENDOR_REP}}
                </td>
            </tr>

            <!-- 基本条件 -->
            <tr class="sec-row"><td colspan="2">基　本　条　件</td></tr>
            <tr>
                <td class="col-item">
                    本件業務の範囲<span class="art-ref">（第1条・第3条）</span>
                    <span class="sub-note">個別業務の内容は発注書により定める</span>
                </td>
                <td class="col-value">発注書に定めるとおり</td>
            </tr>
            <tr>
                <td class="col-item">
                    契約形態<span class="art-ref">（第2条）</span>
                    <span class="sub-note">請負・準委任・委任の別</span>
                </td>
                <td class="col-value">各業務の性質に応じ、発注書において定める</td>
            </tr>
            <tr>
                <td class="col-item">
                    契約期間<span class="art-ref">（第14条）</span>
                    <span class="sub-note">更新・中途解約は本契約本文による</span>
                </td>
                <td class="col-value">{{#if CONTRACT_PERIOD_SUMMARY}}{{CONTRACT_PERIOD_SUMMARY}}{{else}}本契約の有効期間は、契約締結日から1年間とする。ただし、期間満了日の1か月前までに、いずれか一方の当事者から相手方に対して書面による更新拒絶の意思表示がないときは、本契約は同一条件でさらに1年間自動的に更新されるものとし、以後も同様とする。{{/if}}</td>
            </tr>

            <!-- 報酬・支払・税務 -->
            <tr class="sec-row"><td colspan="2">報　酬・支　払・税　務</td></tr>
            <tr>
                <td class="col-item">
                    支払条件<span class="art-ref">（第8条）</span>
                    <span class="sub-note">個別条件は発注書により定める</span>
                </td>
                <td class="col-value">発注書に定めるとおり</td>
            </tr>
            <tr>
                <td class="col-item">
                    振込先銀行口座<span class="art-ref">（第8条・第13条）</span>
                    <span class="sub-note">変更時は乙から速やかに通知</span>
                </td>
                <td class="col-value">
                    {{BANK_NAME}}　{{BRANCH_NAME}}<br>
                    {{ACCOUNT_TYPE}}　{{ACCOUNT_NUMBER}}<br>
                    口座名義（カナ）：{{ACCOUNT_HOLDER_KANA}}
                </td>
            </tr>
            <tr>
                <td class="col-item">
                    インボイス制度関連<span class="art-ref">（第8条・第13条）</span>
                    <span class="sub-note">適格請求書発行事業者の登録状況</span>
                </td>
                <td class="col-value">
                    適格請求書発行事業者：{{invoiceLabel IS_INVOICE_ISSUER}}<br>
                    登録番号：{{invoiceRegistrationDisplay}}
                </td>
            </tr>

            <!-- 通知先 -->
            <tr class="sec-row"><td colspan="2">通　知　先</td></tr>
            <tr>
                <td class="col-item">
                    委託者（甲）通知先<span class="art-ref">（第23条）</span>
                    <span class="sub-note">本契約上の通知の宛先</span>
                </td>
                <td class="col-value">
                    担当者：{{STAFF_NAME}}<br>
                    電話：{{STAFF_PHONE}}<br>
                    E-mail：{{STAFF_EMAIL}}
                </td>
            </tr>
            <tr>
                <td class="col-item">
                    受託者（乙）通知先<span class="art-ref">（第23条）</span>
                    <span class="sub-note">本契約上の通知の宛先</span>
                </td>
                <td class="col-value notice-contractor">
                    担当者：{{NOTICE_CONTACT_NAME}}<br>
                    電話：{{NOTICE_CONTACT_PHONE}}<br>
                    E-mail：{{NOTICE_CONTACT_EMAIL}}
                </td>
            </tr>

            {{#if REMARKS}}
            <tr class="sec-row"><td colspan="2">特　記　事　項</td></tr>
            <tr>
                <td colspan="2" class="special-cell">{{REMARKS}}</td>
            </tr>
            {{/if}}
        </tbody>
    </table>

    <!-- 頭書き下部署名欄 -->
    <div class="head-signature">
        {{!-- 署名日は頭書の契約締結日(CONTRACT_DATE)と一致させる。SIGN_DATE を明示指定した
             場合のみそれを優先。旧テンプレは "2026年5月24日" をベタ書きしており、頭書の
             締結日と食い違う不整合の原因になっていた。 --}}
        <div class="sig-date">{{or SIGN_DATE CONTRACT_DATE}}</div>
        <div class="sig-grid">
            <div class="sig-party">
                <div class="party-label">甲（委託者）</div>
                <div>{{PARTY_A_ADDRESS}}</div>
                <div>{{PARTY_A_NAME}}</div>
                <div class="sig-name-row">
                    <span>{{PARTY_A_REP}}</span>
                    <span class="stamp-box">印</span>
                </div>
            </div>
            <div class="sig-party">
                <div class="party-label">乙（受託者）</div>
                <div>{{VENDOR_ADDRESS}}</div>
                <div>{{VENDOR_NAME}}</div>
                <div class="sig-name-row">
                    <span>{{VENDOR_REP}}</span>
                    <span class="stamp-box">印</span>
                </div>
            </div>
        </div>
    </div>

    <p class="preamble">甲および乙（以下「両当事者」という）は、甲が乙に対して委託する業務（以下「本件業務」という）について、以下のとおり業務委託基本契約（以下「本契約」という）を締結する。</p>

    <div class="article-block">
        <h2>第1条（目的）</h2>
        <ol>
            <li>本契約は、甲が乙に対して業務を委託する場合における、両当事者間の基本的な取引条件を定めることを目的とする。</li>
            <li>本契約において、個別の業務の内容、納期、報酬その他の具体的な条件については、本契約に基づき甲が発行する発注書（以下「発注書」という）および乙が提出する見積書等により定めるものとし、発注書の内容が本契約の内容と矛盾または抵触する場合には、発注書の内容が優先するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第2条（契約形態）</h2>
        <ol>
            <li>本契約および発注書により成立する個別の業務委託契約の形態は、各業務の性質に応じて、委任契約、準委任契約または請負契約のいずれかとし、発注書において明示するものとする。発注書に明示がない場合には、当該業務の性質に照らし、成果物の完成を目的とする場合には請負契約、それ以外の場合には委任契約または準委任契約とする。</li>
            <li>請負契約の場合、乙は成果物を完成させる義務を負い、甲は成果物の完成および引渡しをもって報酬を支払うものとする。</li>
            <li>準委任契約の場合、乙は善良なる管理者の注意をもって業務を遂行する義務を負い、成果物の完成義務は負わないものとする。なお、委任契約の場合も同様とする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第3条（業務の委託）</h2>
        <ol>
            <li>甲が乙に対して業務を委託する場合には、発注書を発行するものとする。発注書は、書面または電磁的方法（電子メール、クラウドストレージ上での共有等を含む。以下同じ。）により交付されるものとする。</li>
            <li>乙は、発注書を受領した後、速やかにその内容を確認し、発注内容を承諾する場合には、甲に対して乙が以下のいずれかの方法により承諾の意思表示をした時点で契約が成立するものとすることに合意する。
                <ol>
                    <li>書面または電子メール等の電磁的記録による承諾通知</li>
                    <li>業務の着手</li>
                    <li>その他、明確な承諾の意思表示</li>
                </ol>
            </li>
            <li>乙が発注書の内容に異議がある場合、または履行が困難であると判断した場合には、速やかに甲に対してその旨を通知し、甲乙協議のうえ、発注内容の変更または発注の撤回を行うことができるものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第4条（発注書の記載事項）</h2>
        <ol>
            <li>発注書には、個別の業務の内容、報酬、納期、成果物の仕様、納品場所その他業務遂行に必要な事項を記載するものとする。なお、本件業務に中小受託取引適正化法（以下「取適法」という。）または特定受託事業者に係る取引の適正化等に関する法律（以下「フリーランス法」という。）その他の法令が適用される場合には、甲は、当該法令の規定に従い必要な事項を発注書に明示するものとする。</li>
            <li>甲は、発注書の記載内容を作成した日から3年間保存するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第5条（業務の遂行）</h2>
        <ol>
            <li>甲および乙は、相互に独立した契約当事者であり、本契約の締結により、雇用、代理、合弁、パートナーシップその他の特別な法律関係が創設されるものではないことを確認する。</li>
            <li>乙は、準委任契約に該当する業務については、自己の裁量と責任のもと、善良なる管理者の注意をもって誠実にこれを遂行するものとする。なお、甲は乙に対して、業務遂行の過程における手順等について具体的な指示を行わないものとし、乙の主体的な遂行を尊重するものとする。ただし、成果物に関する仕様、品質、納期についての協議はこれを妨げないものとする。</li>
            <li>乙は、請負契約に該当する業務については、成果物を完成させる義務を負い、甲は、乙から納品された成果物に対して、検収を行うものとし、甲が当該検収に係る合格通知を乙に送付したことをもって履行完了とする。</li>
            <li>乙は、本件業務の遂行にあたり、関連する法令、規則、ガイドライン等を遵守するとともに、甲から業務の遂行状況について報告を求められた場合には、速やかにこれに応じるものとする。</li>
            <li>乙は、原則として甲の施設・設備等を使用せず、自ら管理する環境下で業務を遂行するものとする。ただし、必要がある場合は事前に甲と協議するものとする。また、乙が本件業務の全部または一部を第三者に再委託する場合には、あらかじめ甲の書面による承諾を得なければならず、乙は再委託先の行為について一切の責任を負うものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第6条（成果物の納品および業務の完了）</h2>
        <ol>
            <li>本条は、請負契約と準委任契約の区分に応じて以下のとおり適用されるものとする。</li>
            <li><strong>請負契約の場合</strong>においては、以下の各号の定めによるものとする。
                <ol>
                    <li>乙は、発注書に定められた納期および形式に従い、成果物を甲に納入するものとする。なお「納入」とは、甲が指定する場所または方法により、成果物が甲に到達したことを指し、成果物が納入された時点で、当該成果物に関する危険負担は乙から甲に移転するものとする。</li>
                    <li>甲は、成果物の納入後、速やかに検収を行い、内容が発注書の定めに適合しない場合は、乙に対し修正または追完を求めることができるものとする。この場合において、乙は、合理的な期間内にこれに対応し、再納入するものとする。</li>
                    <li>成果物が甲の検収に適合したと認められた時点で、引渡しが完了したものとし、当該成果物の所有権は乙から甲に移転するものとする。なお、検収方法および合否通知の手続は、当該発注書により別途定めるものとする。</li>
                </ol>
            </li>
            <li><strong>準委任契約の場合</strong>においては、以下の各号の定めによるものとする。
                <ol>
                    <li>乙は、発注書に定める期間および内容に従って、業務を誠実に遂行するものとする。</li>
                    <li>業務提供が完了した時点で、当該準委任業務は完了するものとする。ただし、当該業務に成果物が伴う場合の納入・引渡しの取扱いについては、発注書により別途定めるものとする。</li>
                    <li>準委任契約における業務完了の確認方法（例：報告書提出の有無、甲による承認等）については、当該発注書に定めるものとする。</li>
                </ol>
            </li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第7条（契約不適合および修正対応）</h2>
        <ol>
            <li>乙が納品または遂行した業務の成果物または成果が、発注書、仕様書、または本契約の定める内容に適合しない場合（以下「契約不適合」という）、甲は、まず乙に対し契約不適合の具体的内容を書面で通知し、合理的な期間を定めて協議を求めるものとする。</li>
            <li>前項の協議において解決に至らない場合、または乙が協議に応じない場合、甲は以下の対応を選択し、乙に対し請求することができるものとする。
                <ol>
                    <li>成果物の修正または業務の再実施</li>
                    <li>報酬の全部または一部の減額</li>
                    <li>契約の全部または一部の解除</li>
                    <li>報酬の支払拒否</li>
                </ol>
            </li>
            <li>本条の対応は、契約類型に応じて以下の基準に従うものとする。
                <ol>
                    <li><strong>請負契約に該当する場合</strong>においては、甲は、成果物の納品後1年以内に契約不適合の内容を乙に通知することができるものとし、乙は、速やかにかつ無償で修正または再納品を行う義務を負うものとする。重大な不適合が解消されない場合、甲は第2項各号の措置を講じることができるものとする。</li>
                    <li><strong>準委任契約に該当する場合</strong>においては、乙の業務遂行に重大な義務違反があると甲が合理的に判断した場合、相互に協議の上で、甲は報酬の全部または一部の支払を拒否し、または減額することができるものとする。なお、成果物を伴う場合には、請負契約に準じた対応とすることができるものとする。</li>
                </ol>
            </li>
            <li>契約不適合の判断および対応の具体的内容については、発注書または仕様書において別途定めることができるものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第8条（報酬の支払）</h2>
        <ol>
            <li>甲は、乙に対し、個別業務の対価として、発注書に定められた報酬を支払うものとする。</li>
            <li>請負契約の場合、甲は、検収完了後、乙からの請求に基づき、請求書受領日の属する月の翌月末日までに、乙が指定する銀行口座への振込みにより報酬を支払うものとする。ただし、取適法またはフリーランス法が適用される場合には、成果物等の給付を受領した日（検収日）から起算して60日以内の、発注書に定める支払期日までに支払うものとする。</li>
            <li>準委任契約または委任契約の場合、甲は、乙が業務を遂行した期間に応じた報酬を、毎月末日締め、翌月末日払いで支払うものとする。ただし、取適法またはフリーランス法が適用される場合には、給付を受領した日から起算して60日以内の、発注書に定める支払期日までに支払うものとする。</li>
            <li>乙は、報酬の請求にあたり、適格請求書発行事業者として登録されている場合には、適格請求書（いわゆるインボイス）を発行するものとする。未登録の場合には、その旨を甲に通知するとともに、消費税相当額の取扱いについて甲乙協議するものとする。</li>
            <li>振込手数料は甲の負担とする。</li>
            <li>報酬の支払が遅延した場合、甲は乙に対して、支払期日の翌日から支払済みに至るまで、年14.6%の割合による遅延損害金を支払うものとする。</li>
            <li>天災地変、金融機関のシステム障害その他の不可抗力により支払期日に支払いができないやむを得ない事情が生じた場合、甲は速やかに乙に通知し、可能な限り早期の支払いに努めるものとする。ただし、取適法またはフリーランス法が適用される場合は、当該法令の定める支払期日を遵守するものとし、不可抗力を理由とする免責は認められないものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第9条（知的財産権）</h2>
        <ol>
            <li>本件業務の遂行により生じた成果物に関する著作権（著作権法第27条および第28条に定める権利を含む。）、特許権、実用新案権、意匠権、商標権その他一切の知的財産権（以下「知的財産権」という。）は、発注書に別段の定めがない限り、甲に帰属するものとする。乙は、成果物の完成と同時に、甲に対して当該知的財産権を譲渡するものとする。</li>
            <li>前項の規定にかかわらず、乙が本件業務の遂行以前から保有していた技術、ノウハウ、著作物その他の知的財産（以下「乙既存知的財産」という。）に関する権利は、乙に留保されるものとする。乙が成果物の一部として乙既存知的財産を使用する場合には、甲に対して、当該乙既存知的財産を本件業務の目的の範囲内で使用する非独占的な使用許諾を付与するものとする。</li>
            <li>乙は、成果物の完成に関して、著作者人格権を行使しないものとする。ただし、成果物が乙の名誉または声望を害する態様で使用される場合には、この限りではない。</li>
            <li>成果物に第三者の知的財産権を侵害する部分があり、または侵害するおそれがあることが判明した場合、乙は自己の責任と費用負担において、当該部分を非侵害のものに置き換え、または必要な権利処理を行うものとする。ただし、甲の指示に基づく部分に起因する侵害については、甲がその責任を負うものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第10条（資料の取扱い）</h2>
        <ol>
            <li>甲は、乙が本件業務を遂行するために必要と認める資料を、乙に提供するものとする。</li>
            <li>乙は、提供を受けた資料を善良なる管理者の注意義務をもって取り扱い、甲の書面による事前の承諾なく複製または第三者への提供を行わないものとする。</li>
            <li>乙は、提供資料を本件業務の遂行のみに使用するものとし、他目的への流用を禁止されるものとする。</li>
            <li>契約終了時または甲の指示があった場合、乙は速やかに資料を返却または破棄するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第11条（秘密保持）</h2>
        <ol>
            <li>甲および乙（以下「両当事者」という）は、本契約に関連して知り得た、相手方の技術上または営業上その他業務上の情報であって、秘密として取り扱われるべき情報（以下「秘密情報」という）を、第三者に漏洩または開示せず、本契約の履行の目的にのみ使用するものとする。なお、当該秘密情報には、当該情報が書面、口頭、電磁的記録その他のいかなる方法により開示されたかを問わず、またその表示の有無にかかわらず、秘匿性を有する一切の情報を含むものとする。ただし、次の各号のいずれかに該当する情報は、秘密情報に含まれないものとする。
                <ol>
                    <li>開示を受けた時点で既に公知となっている情報</li>
                    <li>開示を受けた後、受領者の責によらず公知となった情報</li>
                    <li>開示を受けた時点で既に受領者が適法に保有していた情報</li>
                    <li>正当な権限を有する第三者から適法に入手した情報</li>
                    <li>受領者が独自に開発した情報（相手方の秘密情報によらずして）</li>
                </ol>
            </li>
            <li>両当事者は、法令に基づく開示義務、または裁判所、行政機関その他の公的機関からの命令等により秘密情報の開示を求められた場合には、可能な限り事前に相手方に通知し、相手方の意向を尊重するよう努めるものとする。</li>
            <li>本条の義務は、本契約終了後も5年間存続するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第12条（個人情報の取扱い）</h2>
        <ol>
            <li>本契約における個人情報とは、個人情報保護法第2条第1項に定める情報をいうものとする。</li>
            <li>甲および乙は、個人情報を本件業務の範囲内に限定して取り扱い、目的外利用を行わないものとする。</li>
            <li>甲および乙は、個人情報の取扱いについて、個人情報保護法その他の関連法令および個人情報保護委員会のガイドラインを遵守し、個人情報の漏洩、滅失またはき損の防止その他の個人情報の安全管理のために必要かつ適切な措置を講じなければならない。</li>
            <li>甲および乙は、個人情報の漏洩等の事故が発生した場合、直ちに相手方に通知するとともに、その原因を調査し、再発防止のために必要な措置を講じるものとする。</li>
            <li>甲および乙は、本件業務の遂行にあたり、個人情報の取扱いを第三者に委託してはならない。ただし、相手方の事前の書面による承諾がある場合はこの限りではない。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第13条（届出事項の変更）</h2>
        <ol>
            <li>乙は、本契約冒頭に記載した商号（氏名）、代表者、住所（居所）、連絡先、振込先銀行口座、事業者区分、インボイス登録状況（適格請求書発行事業者の登録番号の取得または廃止を含む。）その他甲に届け出た事項に変更が生じた場合、速やかに書面または電磁的方法により甲に通知しなければならない。</li>
            <li>前項の通知がなされなかったことにより、甲から乙に対する通知、書類の送付または報酬の支払いが延着し、または不能となった場合、甲はこれによる遅滞の責任を負わないものとする。</li>
            <li>乙が第1項の通知を怠ったことに起因して生じた損害について、甲は一切の責任を負わないものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第14条（契約期間、更新および中途解約）</h2>
        <ol>
            <li>本契約の有効期間は、頭書き基本条件の契約開始日（記載がない場合は契約締結日）から１年間とする。ただし、期間満了日の１か月前までに、いずれか一方の当事者から相手方に対して書面による更新拒絶の意思表示がないときは、本契約は同一条件でさらに１年間自動的に更新されるものとし、以後も同様とする。</li>
            <li>契約期間中であっても、やむを得ない事由により本契約を解約する必要が生じた場合、当事者は相手方に対して少なくとも30日前までに書面にて通知するものとする。</li>
            <li>本契約が中途解約または期間満了により終了した場合であっても、以下の個別契約については、その完了または終了まで本契約の関連条項が適用されるものとし、当該個別契約に関する権利義務は継続するものとする。
                <ol>
                    <li>本契約終了時点で既に委託され履行中の個別業務</li>
                    <li>本契約終了時点で契約が成立しているが未着手の個別業務</li>
                </ol>
            </li>
            <li>前項の個別契約について、当該個別契約の履行期間が本契約終了日から起算して6か月以上ある場合には、甲または乙は、相手方に対して1か月前までに書面で通知することにより、当該個別契約を中途解約することができるものとする。この場合において、既に履行された部分についての報酬および費用は、発注書の定めに従って精算するものとする。</li>
            <li>前各項の規定にかかわらず、本契約の秘密保持義務、知的財産権に関する条項、損害賠償に関する条項その他の性質上契約終了後も効力を有する条項については、本契約終了後も引き続き効力を有するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第15条（契約の解除）</h2>
        <ol>
            <li>甲または乙は、相手方が本契約に違反し、相当の期間を定めて書面により是正の催告を行ったにもかかわらず、是正されない場合には、本契約の全部または一部を解除することができるものとする。</li>
            <li>次の各号のいずれかに該当した場合には、催告を要せず直ちに本契約を解除することができるものとする。
                <ol>
                    <li>履行不能または履行拒否</li>
                    <li>差押え、仮差押え等の処分を受けたとき</li>
                    <li>不渡り、支払停止、破産等の申立てがあったとき</li>
                    <li>解散または事業の重要部分の譲渡</li>
                    <li>信用不安が生じたと認められるとき</li>
                </ol>
            </li>
            <li>解除によって損害が生じた場合でも、解除権の行使自体に関して損害賠償の責任は負わないものとする。</li>
            <li>本条に基づき本契約が解除された場合でも、解除した当事者は、解除により生じた損害の賠償を相手方に対し請求することができるものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第16条（損害賠償）</h2>
        {{!-- 損害賠償条項は基本契約フォームの LIABILITY_CLAUSE で 2 型を切替。
             限定条項＝上限に直近12か月分の下限を付す版 / 既定(else)＝拡大条項。 --}}
        {{#if (eq LIABILITY_CLAUSE "限定条項")}}
        <ol>
            <li>甲および乙は、相手方の責めに帰すべき事由（故意または過失による本契約の違反、不法行為その他の事由を含む。）により損害を被った場合、相手方に対し、当該損害（弁護士費用、人件費、逸失利益その他の直接または間接の損害を含む。）の賠償を請求することができる。</li>
            <li>前項にかかわらず、乙が甲に対して負う損害賠償責任の総額は、本契約に基づき甲が乙に対して支払い、または支払うべき業務委託料の総額を上限とする。ただし、当該上限額は、損害発生の直近12か月間に甲が乙に対して支払った業務委託料の額を下回らないものとする。</li>
            <li>前項の規定は、次の各号のいずれかに該当する場合には適用しない。
                <ol>
                    <li>乙の故意または重大な過失に起因する損害</li>
                    <li>乙による秘密保持義務の違反に起因する損害</li>
                    <li>乙による個人情報または甲の顧客情報等の漏えいその他情報管理義務の違反に起因する損害</li>
                    <li>乙による第三者の知的財産権その他の権利の侵害に起因する損害</li>
                    <li>第三者から甲に対してなされた請求に基づき甲が負担した損害</li>
                </ol>
            </li>
            <li>本条は、請負契約・準委任契約その他契約形態のいかんを問わず適用する。</li>
        </ol>
        {{else}}
        <ol>
            <li>甲および乙は、相手方の責めに帰すべき事由（故意または過失による本契約の違反、不法行為その他の事由を含む。）により損害を被った場合、相手方に対し、当該損害（弁護士費用、人件費、逸失利益その他の直接または間接の損害を含む。）の賠償を請求することができる。</li>
            <li>前項にかかわらず、乙が甲に対して負う損害賠償責任の総額は、本契約に基づき甲が乙に対して支払い、または支払うべき業務委託料の総額を上限とする。ただし、以下の各号のいずれかに該当する場合は、当該上限は適用しない。
                <ol>
                    <li>乙の故意または重大な過失に起因する場合</li>
                    <li>乙による秘密保持義務の違反</li>
                    <li>乙による個人情報または甲の顧客情報等の漏えいその他の情報管理義務違反</li>
                    <li>乙による第三者の知的財産権その他の権利の侵害</li>
                    <li>第三者から甲に対してなされた請求に基づき甲が負担した損害</li>
                </ol>
            </li>
            <li>本条は、請負契約・準委任契約その他の契約形態を問わず適用する。</li>
        </ol>
        {{/if}}
    </div>

    <div class="article-block">
        <h2>第17条（権利義務の譲渡禁止）</h2>
        <ol>
            <li>甲および乙は、相手方の書面による事前の承諾なく、本契約に基づく地位または権利義務を第三者に譲渡し、承継させ、または担保に供してはならない。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第18条（中小受託取引適正化法および特定受託事業者法等の適用）</h2>
        <ol>
            <li>本契約において、乙が中小受託取引適正化法（以下「取適法」という。）における中小受託事業者、または特定受託事業者に係る取引の適正化等に関する法律（以下「フリーランス法」という。）における特定受託事業者に該当し、本件業務が同法令の適用対象となる場合、甲は当該法令に従い、以下の義務を履行するものとする。
                <ol>
                    <li>書面または電磁的方法により、業務の内容、報酬額または算定方法、納期、支払期日、成果物の有無および仕様、再委託の可否、経費負担の有無、業務遂行場所および就業時間（該当する場合）その他法令で求められる事項を明示すること。</li>
                    <li>成果物等の受領後、遅滞なく検収を行い、給付を受領した日から起算して20日以内に検収結果を乙に通知すること。通知がない場合は、当該給付を検収済みとみなす。</li>
                    <li>給付受領日から60日以内に報酬を支払うこと。</li>
                    <li>ハラスメント行為の防止措置を講じ、以下の相談窓口を設置し、乙に通知すること。乙が相談を行ったことを理由に不利益な取扱いをしない。
                        <br><strong>【相談窓口情報】</strong>
                        <br>名称: KADOKAWAグループホットライン
                        <br>WEBフォーム: https://koueki-tsuhou.com/slmfze8pka9s/
                        <br>電話: 0120-996-206（平日8:30~19:00、土曜8:30~17:00）
                        <br>対応言語: 日本語・英語・中国語
                    </li>
                    <li>取引記録等を作成し、3年間保存すること。</li>
                    <li>価格の一方的決定、報酬の不当な減額、買いたたき、返品強要、受領拒否、報酬支払遅延、直前キャンセル、購入・利用強制、不当な経費負担転嫁、振込手数料の乙への転嫁、手形払いの強制、その他法令により禁止される行為を行わないこと。</li>
                </ol>
            </li>
            <li>乙が中小事業者または特定受託事業者に該当するか否かは、各法令に定める客観的要件（資本金額、法人・個人の別等）に基づき判断されるものとする。甲は、契約締結時に乙の該当性を確認し、書面または電磁的方法により乙に通知するものとする。契約期間中に該当性が変更された場合には、双方は速やかに相互に通知し、必要に応じて契約条件を協議・見直すものとする。</li>
            <li>本条の内容は、他条項に優先して適用されるものとし、他条項との間に矛盾または重複が生じた場合には、本条の定めを優先する。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第19条（反社会的勢力の排除）</h2>
        <ol>
            <li>甲および乙は、次の各号のいずれにも該当しないことを表明し、かつ将来にわたっても該当しないことを確約するものとする。
                <ol>
                    <li>自らが暴力団、暴力団員、暴力団準構成員、暴力団関係企業、総会屋等、社会運動等標ぼうゴロまたは特殊知能暴力集団等、その他これらに準ずる者(以下「反社会的勢力」という。)であること</li>
                    <li>自らの役員（取締役、執行役、執行役員、監査役またはこれらに準ずる者をいう。）が反社会的勢力であること</li>
                    <li>反社会的勢力に自己の名義を利用させ、本契約を締結すること</li>
                    <li>自らまたは第三者を利用して、本契約に関して相手方に対する脅迫的な言動または暴力を用いる行為</li>
                    <li>自らまたは第三者を利用して、本契約に関して、偽計または威力を用いて相手方の業務を妨害し、または信用を毀損する行為</li>
                </ol>
            </li>
            <li>甲または乙は、相手方が前項各号のいずれかに該当した場合には、何らの催告を要せず、本契約の全部または一部を解除することができるものとする。</li>
            <li>甲または乙が前項の規定により本契約を解除した場合には、解除により相手方に生じた損害の賠償責任を負わないものとする。また、解除により自らに生じた損害につき、相手方に対し損害賠償請求することができるものとする。</li>
            <li>甲および乙は、自らまたはその役員もしくは実質的に経営を支配する者が反社会的勢力との間で、次の各号のいずれかに該当する関係を有することが判明した場合には、相手方に直ちに報告するものとする。
                <ol>
                    <li>反社会的勢力が経営を支配していると認められるとき</li>
                    <li>反社会的勢力が経営に実質的に関与していると認められるとき</li>
                    <li>自己、自社もしくは第三者の不正の利益を図る目的または第三者に損害を加える目的をもってするなど、不当に反社会的勢力を利用したと認められるとき</li>
                    <li>反社会的勢力に対して資金等を提供し、または便宜を供与するなどの関与をしていると認められるとき</li>
                    <li>その他役員または経営に実質的に関与している者が、反社会的勢力と社会的に非難されるべき関係を有しているとき</li>
                </ol>
            </li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第20条（準拠法および合意管轄）</h2>
        <ol>
            <li>本契約は日本法に準拠し解釈されるものとする。</li>
            <li>本契約に関して訴訟、調停その他の法的手続の必要が生じた場合には、東京地方裁判所を第一審の専属的合意管轄裁判所とするものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第21条（協議解決）</h2>
        <ol>
            <li>本契約に定めのない事項または解釈に疑義が生じた事項については、甲乙誠意をもって協議のうえ円満に解決するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第22条（従前契約の包括および解除）</h2>
        <ol>
            <li>甲および乙は、本契約締結日以前に甲乙間で締結されたすべての業務委託に関する契約、合意書、覚書その他の取決め（以下「従前契約」という。）を本契約に包括的に統合するものとする。</li>
            <li>甲および乙は、本契約の締結と同時に、従前契約のすべてを合意により解除するものとする。ただし、以下各項に定める権利義務については、当該各項の定めに従って処理するものとする。</li>
            <li>本契約締結時点において従前契約に基づき履行中または履行予定の個別業務については、甲は発注書を新たに発行することなく、当該業務を本契約に基づく個別業務として取り扱うものとし、乙は引き続きこれを履行するものとする。この場合において、当該業務の委託料、納期、仕様その他の条件は従前契約における定めによるものとし、甲および乙は必要に応じて別途確認書を作成することができる。</li>
            <li>従前契約に基づく甲乙間の債権債務（未払いの業務委託料、経費の精算、損害賠償債務等を含む。）は、本契約に承継されるものとし、甲および乙は本契約の定めに従ってこれを履行するものとする。</li>
            <li>従前契約において定められた次の各号に掲げる義務については、本契約の対応する条項に基づき引き続き効力を有するものとする。
                <ol>
                    <li>秘密保持義務（従前契約により甲または乙が取得した秘密情報に係る義務を含む。）</li>
                    <li>知的財産権に関する義務（従前契約により既に作成された成果物に係る義務を含む。）</li>
                    <li>資料の返却義務</li>
                    <li>競業避止義務（従前契約において定めがある場合に限る。）</li>
                    <li>その他従前契約の終了後も存続すべき義務</li>
                </ol>
            </li>
            <li>甲および乙は、従前契約の解除により相手方に何らの損害も生じないことを相互に確認し、従前契約の解除に関して相手方に対する損害賠償請求権を相互に放棄するものとする。ただし、前各項に基づき本契約に承継される権利義務については、この限りではない。</li>
            <li>従前契約の解釈または履行に関する紛争が生じた場合には、甲および乙は第20条および第21条の定めに従ってこれを解決するものとする。</li>
            <li>本条において「従前契約」とは、甲乙間で別途作成する一覧表に記載される契約をいうものとし、当該一覧表は本契約の一部を構成するものとする。ただし、当該一覧表に記載されていない契約であっても、本契約締結日以前に甲乙間で締結された業務委託に関する契約等については、第1項の定めに従い本契約に包括されるものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第23条（通知）</h2>
        <ol>
            <li>本契約に基づく通知、承諾その他の連絡は、当事者が事前に相手方に対して指定した通知先（頭書きに記載の担当者、電話番号および電子メールアドレスを含む。）に対して、書面、電子メールその他当事者間で合意した方法により行うものとする。</li>
            <li>各当事者は、自らの通知先を変更する場合、相手方に対してその旨を速やかに通知するものとし、当該通知が相手方に到達した時点以降、当該変更は有効となる。</li>
            <li>ただし、個別契約（発注書を含む。）に本条と異なる定めがある場合は、当該個別契約の定めを優先する。</li>
        </ol>
    </div>

    <br><br>

    <p>以上、本契約の成立を証するため、両当事者は、本書を2通作成し、記名押印のうえ、各自1通を保有、または、本書の電磁的記録を作成し、甲乙合意の後電子署名を施し、各自その電磁的記録を保管する。</p>

</div>

</body>
</html>
$sm_html$ THEN
    RAISE NOTICE '0125: service_master already up to date, skipping';
    RETURN;
  END IF;

  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  VALUES (tid,
          COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id = tid), 0) + 1,
          $sm_html$<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>業務委託基本契約書</title>
    <style>
        @page {
            size: A4;
            margin: 18mm 20mm 22mm 25mm;
            @bottom-center {
                content: "- " counter(page) " -";
                font-size: 8.5pt;
                font-family: "Noto Serif CJK JP", "IPAMincho", serif;
            }
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: "Noto Serif CJK JP", "IPAMincho", "MS Mincho", serif;
            font-size: 10pt;
            line-height: 1.75;
            color: #000;
            background-color: #fff;
            margin: 0;
            padding: 0;
        }

        .contract-document {
            max-width: 210mm;
            margin: 0 auto;
            background-color: #fff;
            padding: 18mm 20mm 22mm 25mm;
            box-sizing: border-box;
        }

        /* ===== ドキュメントヘッダー ===== */
        .doc-header {
            display: flex;
            justify-content: flex-end;
            align-items: baseline;
            gap: 0.45em;
            margin-bottom: 0.5em;
            font-size: 8.5pt;
            color: #555;
            letter-spacing: 0.05em;
        }

        .doc-header .header-separator {
            color: #aaa;
        }

        /* ===== タイトル ===== */
        h1.contract-title {
            text-align: center;
            font-size: 14pt;
            font-weight: bold;
            letter-spacing: 0.35em;
            margin-bottom: 0.9em;
            text-decoration: underline;
            text-underline-offset: 0.22em;
        }

        h2 {
            font-size: 11pt;
            margin-top: 14px;
            margin-bottom: 6px;
            border-bottom: 1px solid #999;
            padding-bottom: 2px;
        }

        p {
            margin-bottom: 6px;
            text-align: justify;
        }

        ul, ol {
            padding-left: 18px;
            margin-bottom: 6px;
        }

        li { margin-bottom: 3px; }

        /* ===== 頭書き表 ===== */
        .tobogaki {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 1.15em;
            font-size: 9pt;
            line-height: 1.6;
            border-top: 1.5pt solid #1a1a1a;
            border-bottom: 1.5pt solid #1a1a1a;
        }

        .tobogaki th,
        .tobogaki td {
            border: none;
            border-bottom: 0.5pt solid #d8d8d8;
            padding: 0.45em 0.7em;
            vertical-align: top;
        }

        .tobogaki .sec-row td {
            padding-top: 0.9em;
            padding-bottom: 0.25em;
            border-bottom: 0.5pt solid #888;
            font-size: 7.5pt;
            font-weight: bold;
            letter-spacing: 0.25em;
            color: #555;
            text-transform: uppercase;
        }

        .tobogaki .col-item {
            width: 36%;
            font-weight: bold;
            color: #1a1a1a;
            padding-left: 0.5em;
        }

        .tobogaki .col-item .art-ref {
            font-size: 7.5pt;
            font-weight: normal;
            color: #777;
        }

        .tobogaki .col-item .sub-note {
            display: block;
            font-size: 7.5pt;
            font-weight: normal;
            color: #888;
            margin-top: 0.1em;
        }

        .tobogaki .col-value {
            width: 64%;
            word-break: break-all;
            overflow-wrap: break-word;
            color: #1a1a1a;
        }

        /* 受託者(乙)通知先セル: クラウドサイン入力フォーム設置のため行間を広めに確保。 */
        .tobogaki .col-value.notice-contractor {
            line-height: 2.3;
            padding-top: 0.5em;
            padding-bottom: 0.9em;
        }

        .tobogaki .special-cell {
            min-height: 2.5em;
            word-break: break-all;
            overflow-wrap: break-word;
            color: #1a1a1a;
            white-space: pre-wrap;
        }

        /* ===== 頭書き下部署名欄 ===== */
        .head-signature {
            margin: 0.2em 0 1.3em;
            page-break-inside: avoid;
            font-size: 9.2pt;
            line-height: 1.55;
        }

        .head-signature .sig-date {
            text-align: right;
            margin-bottom: 0.8em;
        }

        .head-signature .sig-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.2em;
        }

        .head-signature .sig-party {
            border-top: 1pt solid #1a1a1a;
            padding-top: 0.5em;
        }

        .head-signature .party-label {
            font-weight: bold;
            margin-bottom: 0.3em;
        }

        .head-signature .sig-name-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.8em;
            margin-top: 0.3em;
        }

        .head-signature .stamp-box {
            width: 52px;
            height: 52px;
            border: 1pt solid #1a1a1a;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 11pt;
            background-color: #fff;
            flex-shrink: 0;
        }

        .preamble {
            font-size: 9.5pt;
            text-indent: 1em;
            margin-bottom: 0.9em;
            line-height: 1.7;
        }

        .article-block > ol {
            list-style-type: none;
            counter-reset: item;
            padding-left: 0;
        }

        .article-block > ol > li {
            position: relative;
            padding-left: 1.5em;
            margin-bottom: 5px;
        }

        .article-block > ol > li::before {
            counter-increment: item;
            content: counter(item);
            position: absolute;
            left: 0.2em;
            top: 0;
            font-weight: normal;
        }

        .article-block > ol > li > ol {
            list-style-type: none;
            counter-reset: sub-item;
            padding-left: 0;
            margin-top: 5px;
        }

        .article-block > ol > li > ol > li {
            position: relative;
            padding-left: 2.5em;
            margin-bottom: 5px;
        }

        .article-block > ol > li > ol > li::before {
            counter-increment: sub-item;
            content: "(" counter(sub-item) ")";
            position: absolute;
            left: 0;
            top: 0;
        }

        .article-block { page-break-inside: auto; }
        .article-block h2 { page-break-after: avoid; }
        .no-break { page-break-inside: avoid; }

        @media print {
            body { background-color: #fff; padding: 0; }
            .contract-document {
                box-shadow: none;
                margin: 0;
                width: 100%;
                max-width: none;
                padding: 0;
            }
            h2 { page-break-after: avoid; margin-top: 10px; }
            .article-block { page-break-inside: auto; }
            .article-block > ol > li { page-break-inside: auto; }
            .head-signature, .tobogaki { page-break-inside: avoid; }
            p { orphans: 3; widows: 3; }
        }
    </style>
</head>
<body>

<div class="contract-document">

    <div class="doc-header">
        <span class="header-item">契約締結日：{{CONTRACT_DATE}}</span>
        <span class="header-separator">｜</span>
        <span class="header-item contract-no">契約番号：{{CONTRACT_NO}}</span>
    </div>

    <h1 class="contract-title">業務委託基本契約書</h1>

    <!-- ======================================================
         頭書き（当事者目録・契約条件一覧）
         ====================================================== -->
    <table class="tobogaki">
        <tbody>
            <!-- 当事者 -->
            <tr class="sec-row"><td colspan="2">当　事　者</td></tr>
            <tr>
                <td class="col-item">甲（委託者）</td>
                <td class="col-value">
                    {{PARTY_A_ADDRESS}}<br>
                    {{PARTY_A_NAME}}<br>
                    {{PARTY_A_REP}}
                </td>
            </tr>
            <tr>
                <td class="col-item">乙（受託者）</td>
                <td class="col-value">
                    {{VENDOR_ADDRESS}}<br>
                    {{VENDOR_NAME}}<br>
                    {{VENDOR_REP}}
                </td>
            </tr>

            <!-- 基本条件 -->
            <tr class="sec-row"><td colspan="2">基　本　条　件</td></tr>
            <tr>
                <td class="col-item">
                    本件業務の範囲<span class="art-ref">（第1条・第3条）</span>
                    <span class="sub-note">個別業務の内容は発注書により定める</span>
                </td>
                <td class="col-value">発注書に定めるとおり</td>
            </tr>
            <tr>
                <td class="col-item">
                    契約形態<span class="art-ref">（第2条）</span>
                    <span class="sub-note">請負・準委任・委任の別</span>
                </td>
                <td class="col-value">各業務の性質に応じ、発注書において定める</td>
            </tr>
            <tr>
                <td class="col-item">
                    契約期間<span class="art-ref">（第14条）</span>
                    <span class="sub-note">更新・中途解約は本契約本文による</span>
                </td>
                <td class="col-value">{{#if CONTRACT_PERIOD_SUMMARY}}{{CONTRACT_PERIOD_SUMMARY}}{{else}}本契約の有効期間は、契約締結日から1年間とする。ただし、期間満了日の1か月前までに、いずれか一方の当事者から相手方に対して書面による更新拒絶の意思表示がないときは、本契約は同一条件でさらに1年間自動的に更新されるものとし、以後も同様とする。{{/if}}</td>
            </tr>

            <!-- 報酬・支払・税務 -->
            <tr class="sec-row"><td colspan="2">報　酬・支　払・税　務</td></tr>
            <tr>
                <td class="col-item">
                    支払条件<span class="art-ref">（第8条）</span>
                    <span class="sub-note">個別条件は発注書により定める</span>
                </td>
                <td class="col-value">発注書に定めるとおり</td>
            </tr>
            <tr>
                <td class="col-item">
                    振込先銀行口座<span class="art-ref">（第8条・第13条）</span>
                    <span class="sub-note">変更時は乙から速やかに通知</span>
                </td>
                <td class="col-value">
                    {{BANK_NAME}}　{{BRANCH_NAME}}<br>
                    {{ACCOUNT_TYPE}}　{{ACCOUNT_NUMBER}}<br>
                    口座名義（カナ）：{{ACCOUNT_HOLDER_KANA}}
                </td>
            </tr>
            <tr>
                <td class="col-item">
                    インボイス制度関連<span class="art-ref">（第8条・第13条）</span>
                    <span class="sub-note">適格請求書発行事業者の登録状況</span>
                </td>
                <td class="col-value">
                    適格請求書発行事業者：{{invoiceLabel IS_INVOICE_ISSUER}}<br>
                    登録番号：{{invoiceRegistrationDisplay}}
                </td>
            </tr>

            <!-- 通知先 -->
            <tr class="sec-row"><td colspan="2">通　知　先</td></tr>
            <tr>
                <td class="col-item">
                    委託者（甲）通知先<span class="art-ref">（第23条）</span>
                    <span class="sub-note">本契約上の通知の宛先</span>
                </td>
                <td class="col-value">
                    担当者：{{STAFF_NAME}}<br>
                    電話：{{STAFF_PHONE}}<br>
                    E-mail：{{STAFF_EMAIL}}
                </td>
            </tr>
            <tr>
                <td class="col-item">
                    受託者（乙）通知先<span class="art-ref">（第23条）</span>
                    <span class="sub-note">本契約上の通知の宛先</span>
                </td>
                <td class="col-value notice-contractor">
                    担当者：{{NOTICE_CONTACT_NAME}}<br>
                    電話：{{NOTICE_CONTACT_PHONE}}<br>
                    E-mail：{{NOTICE_CONTACT_EMAIL}}
                </td>
            </tr>

            {{#if REMARKS}}
            <tr class="sec-row"><td colspan="2">特　記　事　項</td></tr>
            <tr>
                <td colspan="2" class="special-cell">{{REMARKS}}</td>
            </tr>
            {{/if}}
        </tbody>
    </table>

    <!-- 頭書き下部署名欄 -->
    <div class="head-signature">
        {{!-- 署名日は頭書の契約締結日(CONTRACT_DATE)と一致させる。SIGN_DATE を明示指定した
             場合のみそれを優先。旧テンプレは "2026年5月24日" をベタ書きしており、頭書の
             締結日と食い違う不整合の原因になっていた。 --}}
        <div class="sig-date">{{or SIGN_DATE CONTRACT_DATE}}</div>
        <div class="sig-grid">
            <div class="sig-party">
                <div class="party-label">甲（委託者）</div>
                <div>{{PARTY_A_ADDRESS}}</div>
                <div>{{PARTY_A_NAME}}</div>
                <div class="sig-name-row">
                    <span>{{PARTY_A_REP}}</span>
                    <span class="stamp-box">印</span>
                </div>
            </div>
            <div class="sig-party">
                <div class="party-label">乙（受託者）</div>
                <div>{{VENDOR_ADDRESS}}</div>
                <div>{{VENDOR_NAME}}</div>
                <div class="sig-name-row">
                    <span>{{VENDOR_REP}}</span>
                    <span class="stamp-box">印</span>
                </div>
            </div>
        </div>
    </div>

    <p class="preamble">甲および乙（以下「両当事者」という）は、甲が乙に対して委託する業務（以下「本件業務」という）について、以下のとおり業務委託基本契約（以下「本契約」という）を締結する。</p>

    <div class="article-block">
        <h2>第1条（目的）</h2>
        <ol>
            <li>本契約は、甲が乙に対して業務を委託する場合における、両当事者間の基本的な取引条件を定めることを目的とする。</li>
            <li>本契約において、個別の業務の内容、納期、報酬その他の具体的な条件については、本契約に基づき甲が発行する発注書（以下「発注書」という）および乙が提出する見積書等により定めるものとし、発注書の内容が本契約の内容と矛盾または抵触する場合には、発注書の内容が優先するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第2条（契約形態）</h2>
        <ol>
            <li>本契約および発注書により成立する個別の業務委託契約の形態は、各業務の性質に応じて、委任契約、準委任契約または請負契約のいずれかとし、発注書において明示するものとする。発注書に明示がない場合には、当該業務の性質に照らし、成果物の完成を目的とする場合には請負契約、それ以外の場合には委任契約または準委任契約とする。</li>
            <li>請負契約の場合、乙は成果物を完成させる義務を負い、甲は成果物の完成および引渡しをもって報酬を支払うものとする。</li>
            <li>準委任契約の場合、乙は善良なる管理者の注意をもって業務を遂行する義務を負い、成果物の完成義務は負わないものとする。なお、委任契約の場合も同様とする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第3条（業務の委託）</h2>
        <ol>
            <li>甲が乙に対して業務を委託する場合には、発注書を発行するものとする。発注書は、書面または電磁的方法（電子メール、クラウドストレージ上での共有等を含む。以下同じ。）により交付されるものとする。</li>
            <li>乙は、発注書を受領した後、速やかにその内容を確認し、発注内容を承諾する場合には、甲に対して乙が以下のいずれかの方法により承諾の意思表示をした時点で契約が成立するものとすることに合意する。
                <ol>
                    <li>書面または電子メール等の電磁的記録による承諾通知</li>
                    <li>業務の着手</li>
                    <li>その他、明確な承諾の意思表示</li>
                </ol>
            </li>
            <li>乙が発注書の内容に異議がある場合、または履行が困難であると判断した場合には、速やかに甲に対してその旨を通知し、甲乙協議のうえ、発注内容の変更または発注の撤回を行うことができるものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第4条（発注書の記載事項）</h2>
        <ol>
            <li>発注書には、個別の業務の内容、報酬、納期、成果物の仕様、納品場所その他業務遂行に必要な事項を記載するものとする。なお、本件業務に中小受託取引適正化法（以下「取適法」という。）または特定受託事業者に係る取引の適正化等に関する法律（以下「フリーランス法」という。）その他の法令が適用される場合には、甲は、当該法令の規定に従い必要な事項を発注書に明示するものとする。</li>
            <li>甲は、発注書の記載内容を作成した日から3年間保存するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第5条（業務の遂行）</h2>
        <ol>
            <li>甲および乙は、相互に独立した契約当事者であり、本契約の締結により、雇用、代理、合弁、パートナーシップその他の特別な法律関係が創設されるものではないことを確認する。</li>
            <li>乙は、準委任契約に該当する業務については、自己の裁量と責任のもと、善良なる管理者の注意をもって誠実にこれを遂行するものとする。なお、甲は乙に対して、業務遂行の過程における手順等について具体的な指示を行わないものとし、乙の主体的な遂行を尊重するものとする。ただし、成果物に関する仕様、品質、納期についての協議はこれを妨げないものとする。</li>
            <li>乙は、請負契約に該当する業務については、成果物を完成させる義務を負い、甲は、乙から納品された成果物に対して、検収を行うものとし、甲が当該検収に係る合格通知を乙に送付したことをもって履行完了とする。</li>
            <li>乙は、本件業務の遂行にあたり、関連する法令、規則、ガイドライン等を遵守するとともに、甲から業務の遂行状況について報告を求められた場合には、速やかにこれに応じるものとする。</li>
            <li>乙は、原則として甲の施設・設備等を使用せず、自ら管理する環境下で業務を遂行するものとする。ただし、必要がある場合は事前に甲と協議するものとする。また、乙が本件業務の全部または一部を第三者に再委託する場合には、あらかじめ甲の書面による承諾を得なければならず、乙は再委託先の行為について一切の責任を負うものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第6条（成果物の納品および業務の完了）</h2>
        <ol>
            <li>本条は、請負契約と準委任契約の区分に応じて以下のとおり適用されるものとする。</li>
            <li><strong>請負契約の場合</strong>においては、以下の各号の定めによるものとする。
                <ol>
                    <li>乙は、発注書に定められた納期および形式に従い、成果物を甲に納入するものとする。なお「納入」とは、甲が指定する場所または方法により、成果物が甲に到達したことを指し、成果物が納入された時点で、当該成果物に関する危険負担は乙から甲に移転するものとする。</li>
                    <li>甲は、成果物の納入後、速やかに検収を行い、内容が発注書の定めに適合しない場合は、乙に対し修正または追完を求めることができるものとする。この場合において、乙は、合理的な期間内にこれに対応し、再納入するものとする。</li>
                    <li>成果物が甲の検収に適合したと認められた時点で、引渡しが完了したものとし、当該成果物の所有権は乙から甲に移転するものとする。なお、検収方法および合否通知の手続は、当該発注書により別途定めるものとする。</li>
                </ol>
            </li>
            <li><strong>準委任契約の場合</strong>においては、以下の各号の定めによるものとする。
                <ol>
                    <li>乙は、発注書に定める期間および内容に従って、業務を誠実に遂行するものとする。</li>
                    <li>業務提供が完了した時点で、当該準委任業務は完了するものとする。ただし、当該業務に成果物が伴う場合の納入・引渡しの取扱いについては、発注書により別途定めるものとする。</li>
                    <li>準委任契約における業務完了の確認方法（例：報告書提出の有無、甲による承認等）については、当該発注書に定めるものとする。</li>
                </ol>
            </li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第7条（契約不適合および修正対応）</h2>
        <ol>
            <li>乙が納品または遂行した業務の成果物または成果が、発注書、仕様書、または本契約の定める内容に適合しない場合（以下「契約不適合」という）、甲は、まず乙に対し契約不適合の具体的内容を書面で通知し、合理的な期間を定めて協議を求めるものとする。</li>
            <li>前項の協議において解決に至らない場合、または乙が協議に応じない場合、甲は以下の対応を選択し、乙に対し請求することができるものとする。
                <ol>
                    <li>成果物の修正または業務の再実施</li>
                    <li>報酬の全部または一部の減額</li>
                    <li>契約の全部または一部の解除</li>
                    <li>報酬の支払拒否</li>
                </ol>
            </li>
            <li>本条の対応は、契約類型に応じて以下の基準に従うものとする。
                <ol>
                    <li><strong>請負契約に該当する場合</strong>においては、甲は、成果物の納品後1年以内に契約不適合の内容を乙に通知することができるものとし、乙は、速やかにかつ無償で修正または再納品を行う義務を負うものとする。重大な不適合が解消されない場合、甲は第2項各号の措置を講じることができるものとする。</li>
                    <li><strong>準委任契約に該当する場合</strong>においては、乙の業務遂行に重大な義務違反があると甲が合理的に判断した場合、相互に協議の上で、甲は報酬の全部または一部の支払を拒否し、または減額することができるものとする。なお、成果物を伴う場合には、請負契約に準じた対応とすることができるものとする。</li>
                </ol>
            </li>
            <li>契約不適合の判断および対応の具体的内容については、発注書または仕様書において別途定めることができるものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第8条（報酬の支払）</h2>
        <ol>
            <li>甲は、乙に対し、個別業務の対価として、発注書に定められた報酬を支払うものとする。</li>
            <li>請負契約の場合、甲は、検収完了後、乙からの請求に基づき、請求書受領日の属する月の翌月末日までに、乙が指定する銀行口座への振込みにより報酬を支払うものとする。ただし、取適法またはフリーランス法が適用される場合には、成果物等の給付を受領した日（検収日）から起算して60日以内の、発注書に定める支払期日までに支払うものとする。</li>
            <li>準委任契約または委任契約の場合、甲は、乙が業務を遂行した期間に応じた報酬を、毎月末日締め、翌月末日払いで支払うものとする。ただし、取適法またはフリーランス法が適用される場合には、給付を受領した日から起算して60日以内の、発注書に定める支払期日までに支払うものとする。</li>
            <li>乙は、報酬の請求にあたり、適格請求書発行事業者として登録されている場合には、適格請求書（いわゆるインボイス）を発行するものとする。未登録の場合には、その旨を甲に通知するとともに、消費税相当額の取扱いについて甲乙協議するものとする。</li>
            <li>振込手数料は甲の負担とする。</li>
            <li>報酬の支払が遅延した場合、甲は乙に対して、支払期日の翌日から支払済みに至るまで、年14.6%の割合による遅延損害金を支払うものとする。</li>
            <li>天災地変、金融機関のシステム障害その他の不可抗力により支払期日に支払いができないやむを得ない事情が生じた場合、甲は速やかに乙に通知し、可能な限り早期の支払いに努めるものとする。ただし、取適法またはフリーランス法が適用される場合は、当該法令の定める支払期日を遵守するものとし、不可抗力を理由とする免責は認められないものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第9条（知的財産権）</h2>
        <ol>
            <li>本件業務の遂行により生じた成果物に関する著作権（著作権法第27条および第28条に定める権利を含む。）、特許権、実用新案権、意匠権、商標権その他一切の知的財産権（以下「知的財産権」という。）は、発注書に別段の定めがない限り、甲に帰属するものとする。乙は、成果物の完成と同時に、甲に対して当該知的財産権を譲渡するものとする。</li>
            <li>前項の規定にかかわらず、乙が本件業務の遂行以前から保有していた技術、ノウハウ、著作物その他の知的財産（以下「乙既存知的財産」という。）に関する権利は、乙に留保されるものとする。乙が成果物の一部として乙既存知的財産を使用する場合には、甲に対して、当該乙既存知的財産を本件業務の目的の範囲内で使用する非独占的な使用許諾を付与するものとする。</li>
            <li>乙は、成果物の完成に関して、著作者人格権を行使しないものとする。ただし、成果物が乙の名誉または声望を害する態様で使用される場合には、この限りではない。</li>
            <li>成果物に第三者の知的財産権を侵害する部分があり、または侵害するおそれがあることが判明した場合、乙は自己の責任と費用負担において、当該部分を非侵害のものに置き換え、または必要な権利処理を行うものとする。ただし、甲の指示に基づく部分に起因する侵害については、甲がその責任を負うものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第10条（資料の取扱い）</h2>
        <ol>
            <li>甲は、乙が本件業務を遂行するために必要と認める資料を、乙に提供するものとする。</li>
            <li>乙は、提供を受けた資料を善良なる管理者の注意義務をもって取り扱い、甲の書面による事前の承諾なく複製または第三者への提供を行わないものとする。</li>
            <li>乙は、提供資料を本件業務の遂行のみに使用するものとし、他目的への流用を禁止されるものとする。</li>
            <li>契約終了時または甲の指示があった場合、乙は速やかに資料を返却または破棄するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第11条（秘密保持）</h2>
        <ol>
            <li>甲および乙（以下「両当事者」という）は、本契約に関連して知り得た、相手方の技術上または営業上その他業務上の情報であって、秘密として取り扱われるべき情報（以下「秘密情報」という）を、第三者に漏洩または開示せず、本契約の履行の目的にのみ使用するものとする。なお、当該秘密情報には、当該情報が書面、口頭、電磁的記録その他のいかなる方法により開示されたかを問わず、またその表示の有無にかかわらず、秘匿性を有する一切の情報を含むものとする。ただし、次の各号のいずれかに該当する情報は、秘密情報に含まれないものとする。
                <ol>
                    <li>開示を受けた時点で既に公知となっている情報</li>
                    <li>開示を受けた後、受領者の責によらず公知となった情報</li>
                    <li>開示を受けた時点で既に受領者が適法に保有していた情報</li>
                    <li>正当な権限を有する第三者から適法に入手した情報</li>
                    <li>受領者が独自に開発した情報（相手方の秘密情報によらずして）</li>
                </ol>
            </li>
            <li>両当事者は、法令に基づく開示義務、または裁判所、行政機関その他の公的機関からの命令等により秘密情報の開示を求められた場合には、可能な限り事前に相手方に通知し、相手方の意向を尊重するよう努めるものとする。</li>
            <li>本条の義務は、本契約終了後も5年間存続するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第12条（個人情報の取扱い）</h2>
        <ol>
            <li>本契約における個人情報とは、個人情報保護法第2条第1項に定める情報をいうものとする。</li>
            <li>甲および乙は、個人情報を本件業務の範囲内に限定して取り扱い、目的外利用を行わないものとする。</li>
            <li>甲および乙は、個人情報の取扱いについて、個人情報保護法その他の関連法令および個人情報保護委員会のガイドラインを遵守し、個人情報の漏洩、滅失またはき損の防止その他の個人情報の安全管理のために必要かつ適切な措置を講じなければならない。</li>
            <li>甲および乙は、個人情報の漏洩等の事故が発生した場合、直ちに相手方に通知するとともに、その原因を調査し、再発防止のために必要な措置を講じるものとする。</li>
            <li>甲および乙は、本件業務の遂行にあたり、個人情報の取扱いを第三者に委託してはならない。ただし、相手方の事前の書面による承諾がある場合はこの限りではない。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第13条（届出事項の変更）</h2>
        <ol>
            <li>乙は、本契約冒頭に記載した商号（氏名）、代表者、住所（居所）、連絡先、振込先銀行口座、事業者区分、インボイス登録状況（適格請求書発行事業者の登録番号の取得または廃止を含む。）その他甲に届け出た事項に変更が生じた場合、速やかに書面または電磁的方法により甲に通知しなければならない。</li>
            <li>前項の通知がなされなかったことにより、甲から乙に対する通知、書類の送付または報酬の支払いが延着し、または不能となった場合、甲はこれによる遅滞の責任を負わないものとする。</li>
            <li>乙が第1項の通知を怠ったことに起因して生じた損害について、甲は一切の責任を負わないものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第14条（契約期間、更新および中途解約）</h2>
        <ol>
            <li>本契約の有効期間は、頭書き基本条件の契約開始日（記載がない場合は契約締結日）から１年間とする。ただし、期間満了日の１か月前までに、いずれか一方の当事者から相手方に対して書面による更新拒絶の意思表示がないときは、本契約は同一条件でさらに１年間自動的に更新されるものとし、以後も同様とする。</li>
            <li>契約期間中であっても、やむを得ない事由により本契約を解約する必要が生じた場合、当事者は相手方に対して少なくとも30日前までに書面にて通知するものとする。</li>
            <li>本契約が中途解約または期間満了により終了した場合であっても、以下の個別契約については、その完了または終了まで本契約の関連条項が適用されるものとし、当該個別契約に関する権利義務は継続するものとする。
                <ol>
                    <li>本契約終了時点で既に委託され履行中の個別業務</li>
                    <li>本契約終了時点で契約が成立しているが未着手の個別業務</li>
                </ol>
            </li>
            <li>前項の個別契約について、当該個別契約の履行期間が本契約終了日から起算して6か月以上ある場合には、甲または乙は、相手方に対して1か月前までに書面で通知することにより、当該個別契約を中途解約することができるものとする。この場合において、既に履行された部分についての報酬および費用は、発注書の定めに従って精算するものとする。</li>
            <li>前各項の規定にかかわらず、本契約の秘密保持義務、知的財産権に関する条項、損害賠償に関する条項その他の性質上契約終了後も効力を有する条項については、本契約終了後も引き続き効力を有するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第15条（契約の解除）</h2>
        <ol>
            <li>甲または乙は、相手方が本契約に違反し、相当の期間を定めて書面により是正の催告を行ったにもかかわらず、是正されない場合には、本契約の全部または一部を解除することができるものとする。</li>
            <li>次の各号のいずれかに該当した場合には、催告を要せず直ちに本契約を解除することができるものとする。
                <ol>
                    <li>履行不能または履行拒否</li>
                    <li>差押え、仮差押え等の処分を受けたとき</li>
                    <li>不渡り、支払停止、破産等の申立てがあったとき</li>
                    <li>解散または事業の重要部分の譲渡</li>
                    <li>信用不安が生じたと認められるとき</li>
                </ol>
            </li>
            <li>解除によって損害が生じた場合でも、解除権の行使自体に関して損害賠償の責任は負わないものとする。</li>
            <li>本条に基づき本契約が解除された場合でも、解除した当事者は、解除により生じた損害の賠償を相手方に対し請求することができるものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第16条（損害賠償）</h2>
        {{!-- 損害賠償条項は基本契約フォームの LIABILITY_CLAUSE で 2 型を切替。
             限定条項＝上限に直近12か月分の下限を付す版 / 既定(else)＝拡大条項。 --}}
        {{#if (eq LIABILITY_CLAUSE "限定条項")}}
        <ol>
            <li>甲および乙は、相手方の責めに帰すべき事由（故意または過失による本契約の違反、不法行為その他の事由を含む。）により損害を被った場合、相手方に対し、当該損害（弁護士費用、人件費、逸失利益その他の直接または間接の損害を含む。）の賠償を請求することができる。</li>
            <li>前項にかかわらず、乙が甲に対して負う損害賠償責任の総額は、本契約に基づき甲が乙に対して支払い、または支払うべき業務委託料の総額を上限とする。ただし、当該上限額は、損害発生の直近12か月間に甲が乙に対して支払った業務委託料の額を下回らないものとする。</li>
            <li>前項の規定は、次の各号のいずれかに該当する場合には適用しない。
                <ol>
                    <li>乙の故意または重大な過失に起因する損害</li>
                    <li>乙による秘密保持義務の違反に起因する損害</li>
                    <li>乙による個人情報または甲の顧客情報等の漏えいその他情報管理義務の違反に起因する損害</li>
                    <li>乙による第三者の知的財産権その他の権利の侵害に起因する損害</li>
                    <li>第三者から甲に対してなされた請求に基づき甲が負担した損害</li>
                </ol>
            </li>
            <li>本条は、請負契約・準委任契約その他契約形態のいかんを問わず適用する。</li>
        </ol>
        {{else}}
        <ol>
            <li>甲および乙は、相手方の責めに帰すべき事由（故意または過失による本契約の違反、不法行為その他の事由を含む。）により損害を被った場合、相手方に対し、当該損害（弁護士費用、人件費、逸失利益その他の直接または間接の損害を含む。）の賠償を請求することができる。</li>
            <li>前項にかかわらず、乙が甲に対して負う損害賠償責任の総額は、本契約に基づき甲が乙に対して支払い、または支払うべき業務委託料の総額を上限とする。ただし、以下の各号のいずれかに該当する場合は、当該上限は適用しない。
                <ol>
                    <li>乙の故意または重大な過失に起因する場合</li>
                    <li>乙による秘密保持義務の違反</li>
                    <li>乙による個人情報または甲の顧客情報等の漏えいその他の情報管理義務違反</li>
                    <li>乙による第三者の知的財産権その他の権利の侵害</li>
                    <li>第三者から甲に対してなされた請求に基づき甲が負担した損害</li>
                </ol>
            </li>
            <li>本条は、請負契約・準委任契約その他の契約形態を問わず適用する。</li>
        </ol>
        {{/if}}
    </div>

    <div class="article-block">
        <h2>第17条（権利義務の譲渡禁止）</h2>
        <ol>
            <li>甲および乙は、相手方の書面による事前の承諾なく、本契約に基づく地位または権利義務を第三者に譲渡し、承継させ、または担保に供してはならない。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第18条（中小受託取引適正化法および特定受託事業者法等の適用）</h2>
        <ol>
            <li>本契約において、乙が中小受託取引適正化法（以下「取適法」という。）における中小受託事業者、または特定受託事業者に係る取引の適正化等に関する法律（以下「フリーランス法」という。）における特定受託事業者に該当し、本件業務が同法令の適用対象となる場合、甲は当該法令に従い、以下の義務を履行するものとする。
                <ol>
                    <li>書面または電磁的方法により、業務の内容、報酬額または算定方法、納期、支払期日、成果物の有無および仕様、再委託の可否、経費負担の有無、業務遂行場所および就業時間（該当する場合）その他法令で求められる事項を明示すること。</li>
                    <li>成果物等の受領後、遅滞なく検収を行い、給付を受領した日から起算して20日以内に検収結果を乙に通知すること。通知がない場合は、当該給付を検収済みとみなす。</li>
                    <li>給付受領日から60日以内に報酬を支払うこと。</li>
                    <li>ハラスメント行為の防止措置を講じ、以下の相談窓口を設置し、乙に通知すること。乙が相談を行ったことを理由に不利益な取扱いをしない。
                        <br><strong>【相談窓口情報】</strong>
                        <br>名称: KADOKAWAグループホットライン
                        <br>WEBフォーム: https://koueki-tsuhou.com/slmfze8pka9s/
                        <br>電話: 0120-996-206（平日8:30~19:00、土曜8:30~17:00）
                        <br>対応言語: 日本語・英語・中国語
                    </li>
                    <li>取引記録等を作成し、3年間保存すること。</li>
                    <li>価格の一方的決定、報酬の不当な減額、買いたたき、返品強要、受領拒否、報酬支払遅延、直前キャンセル、購入・利用強制、不当な経費負担転嫁、振込手数料の乙への転嫁、手形払いの強制、その他法令により禁止される行為を行わないこと。</li>
                </ol>
            </li>
            <li>乙が中小事業者または特定受託事業者に該当するか否かは、各法令に定める客観的要件（資本金額、法人・個人の別等）に基づき判断されるものとする。甲は、契約締結時に乙の該当性を確認し、書面または電磁的方法により乙に通知するものとする。契約期間中に該当性が変更された場合には、双方は速やかに相互に通知し、必要に応じて契約条件を協議・見直すものとする。</li>
            <li>本条の内容は、他条項に優先して適用されるものとし、他条項との間に矛盾または重複が生じた場合には、本条の定めを優先する。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第19条（反社会的勢力の排除）</h2>
        <ol>
            <li>甲および乙は、次の各号のいずれにも該当しないことを表明し、かつ将来にわたっても該当しないことを確約するものとする。
                <ol>
                    <li>自らが暴力団、暴力団員、暴力団準構成員、暴力団関係企業、総会屋等、社会運動等標ぼうゴロまたは特殊知能暴力集団等、その他これらに準ずる者(以下「反社会的勢力」という。)であること</li>
                    <li>自らの役員（取締役、執行役、執行役員、監査役またはこれらに準ずる者をいう。）が反社会的勢力であること</li>
                    <li>反社会的勢力に自己の名義を利用させ、本契約を締結すること</li>
                    <li>自らまたは第三者を利用して、本契約に関して相手方に対する脅迫的な言動または暴力を用いる行為</li>
                    <li>自らまたは第三者を利用して、本契約に関して、偽計または威力を用いて相手方の業務を妨害し、または信用を毀損する行為</li>
                </ol>
            </li>
            <li>甲または乙は、相手方が前項各号のいずれかに該当した場合には、何らの催告を要せず、本契約の全部または一部を解除することができるものとする。</li>
            <li>甲または乙が前項の規定により本契約を解除した場合には、解除により相手方に生じた損害の賠償責任を負わないものとする。また、解除により自らに生じた損害につき、相手方に対し損害賠償請求することができるものとする。</li>
            <li>甲および乙は、自らまたはその役員もしくは実質的に経営を支配する者が反社会的勢力との間で、次の各号のいずれかに該当する関係を有することが判明した場合には、相手方に直ちに報告するものとする。
                <ol>
                    <li>反社会的勢力が経営を支配していると認められるとき</li>
                    <li>反社会的勢力が経営に実質的に関与していると認められるとき</li>
                    <li>自己、自社もしくは第三者の不正の利益を図る目的または第三者に損害を加える目的をもってするなど、不当に反社会的勢力を利用したと認められるとき</li>
                    <li>反社会的勢力に対して資金等を提供し、または便宜を供与するなどの関与をしていると認められるとき</li>
                    <li>その他役員または経営に実質的に関与している者が、反社会的勢力と社会的に非難されるべき関係を有しているとき</li>
                </ol>
            </li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第20条（準拠法および合意管轄）</h2>
        <ol>
            <li>本契約は日本法に準拠し解釈されるものとする。</li>
            <li>本契約に関して訴訟、調停その他の法的手続の必要が生じた場合には、東京地方裁判所を第一審の専属的合意管轄裁判所とするものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第21条（協議解決）</h2>
        <ol>
            <li>本契約に定めのない事項または解釈に疑義が生じた事項については、甲乙誠意をもって協議のうえ円満に解決するものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第22条（従前契約の包括および解除）</h2>
        <ol>
            <li>甲および乙は、本契約締結日以前に甲乙間で締結されたすべての業務委託に関する契約、合意書、覚書その他の取決め（以下「従前契約」という。）を本契約に包括的に統合するものとする。</li>
            <li>甲および乙は、本契約の締結と同時に、従前契約のすべてを合意により解除するものとする。ただし、以下各項に定める権利義務については、当該各項の定めに従って処理するものとする。</li>
            <li>本契約締結時点において従前契約に基づき履行中または履行予定の個別業務については、甲は発注書を新たに発行することなく、当該業務を本契約に基づく個別業務として取り扱うものとし、乙は引き続きこれを履行するものとする。この場合において、当該業務の委託料、納期、仕様その他の条件は従前契約における定めによるものとし、甲および乙は必要に応じて別途確認書を作成することができる。</li>
            <li>従前契約に基づく甲乙間の債権債務（未払いの業務委託料、経費の精算、損害賠償債務等を含む。）は、本契約に承継されるものとし、甲および乙は本契約の定めに従ってこれを履行するものとする。</li>
            <li>従前契約において定められた次の各号に掲げる義務については、本契約の対応する条項に基づき引き続き効力を有するものとする。
                <ol>
                    <li>秘密保持義務（従前契約により甲または乙が取得した秘密情報に係る義務を含む。）</li>
                    <li>知的財産権に関する義務（従前契約により既に作成された成果物に係る義務を含む。）</li>
                    <li>資料の返却義務</li>
                    <li>競業避止義務（従前契約において定めがある場合に限る。）</li>
                    <li>その他従前契約の終了後も存続すべき義務</li>
                </ol>
            </li>
            <li>甲および乙は、従前契約の解除により相手方に何らの損害も生じないことを相互に確認し、従前契約の解除に関して相手方に対する損害賠償請求権を相互に放棄するものとする。ただし、前各項に基づき本契約に承継される権利義務については、この限りではない。</li>
            <li>従前契約の解釈または履行に関する紛争が生じた場合には、甲および乙は第20条および第21条の定めに従ってこれを解決するものとする。</li>
            <li>本条において「従前契約」とは、甲乙間で別途作成する一覧表に記載される契約をいうものとし、当該一覧表は本契約の一部を構成するものとする。ただし、当該一覧表に記載されていない契約であっても、本契約締結日以前に甲乙間で締結された業務委託に関する契約等については、第1項の定めに従い本契約に包括されるものとする。</li>
        </ol>
    </div>

    <div class="article-block">
        <h2>第23条（通知）</h2>
        <ol>
            <li>本契約に基づく通知、承諾その他の連絡は、当事者が事前に相手方に対して指定した通知先（頭書きに記載の担当者、電話番号および電子メールアドレスを含む。）に対して、書面、電子メールその他当事者間で合意した方法により行うものとする。</li>
            <li>各当事者は、自らの通知先を変更する場合、相手方に対してその旨を速やかに通知するものとし、当該通知が相手方に到達した時点以降、当該変更は有効となる。</li>
            <li>ただし、個別契約（発注書を含む。）に本条と異なる定めがある場合は、当該個別契約の定めを優先する。</li>
        </ol>
    </div>

    <br><br>

    <p>以上、本契約の成立を証するため、両当事者は、本書を2通作成し、記名押印のうえ、各自1通を保有、または、本書の電磁的記録を作成し、甲乙合意の後電子署名を施し、各自その電磁的記録を保管する。</p>

</div>

</body>
</html>
$sm_html$,
          cur_schema,
          '0125: 契約期間の自動更新デフォルト+第14条整合 + 受託者通知先の行間(クラウドサイン用)',
          'migration-0125')
  RETURNING id INTO vid;

  UPDATE document_templates SET current_version_id = vid, updated_at = now() WHERE id = tid;
END $sm_mig$;
