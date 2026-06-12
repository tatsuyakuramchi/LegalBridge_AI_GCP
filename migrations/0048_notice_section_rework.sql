-- 0048_notice_section_rework.sql
-- 通知項目の改修(ライセンス/業務委託/出版・個人/出版・法人 基本契約):
--   - 頭書きに「通知先」カテゴリを整備し、両当事者(相手方/当社)の担当者・電話・メールを集約
--   - 当事者欄からは担当・電話・メールを削除(通知先へ集約)
--   - 当社側通知先はフォームの担当者(STAFF_*)を引用
--   - 通知条項に「個別契約を優先する」但し書きを追加
-- TEMPLATE_SOURCE=db の Search/worker が読む document_templates を新版へ更新(0044方式)。
-- disk テンプレ(services/worker/templates/*.html)と整合。

-- ===== service_master =====
WITH t AS (SELECT id FROM document_templates WHERE template_key='service_master'), nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT t.id, COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id=t.id),0)+1,
         $html_service_master$<!DOCTYPE html>
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
                <td class="col-value">{{CONTRACT_PERIOD_SUMMARY}}</td>
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
                <td class="col-value">
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
        <div class="sig-date">2026年5月24日</div>
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
        <h2>第14条（契約期間および中途解約）</h2>
        <ol>
            <li>本契約の有効期間は、{{CONTRACT_PERIOD_SUMMARY}}とする。</li>
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
        <ol>
            <li>甲または乙は、相手方の故意または過失により本契約に違反し、または不法行為その他の原因により損害を与えた場合、当該損害（弁護士費用、人件費、逸失利益等を含む。）を賠償する責任を負うものとする。ただし、請負契約の場合における乙の責任は、原則として、甲が実際に乙に支払った業務委託料を上限とするものとする。</li>
        </ol>
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
                        <br>メール: [email protected]
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
$html_service_master$, $schema_service_master$[{"name": "CONTRACT_NO", "label": "契約番号", "type": "text", "group": "I. 契約締結日", "dbField": "auto.docNumber", "helpText": "生成時に自動採番されます"}, {"name": "CONTRACT_DATE", "label": "契約締結日", "type": "date", "group": "I. 契約締結日", "required": true}, {"name": "PARTY_A_NAME", "label": "甲 (委託者) 商号", "group": "II. 甲 (委託者)", "required": true, "helpText": "[自社] または [取引先] ボタンで自動入力"}, {"name": "PARTY_A_ADDRESS", "label": "甲 (委託者) 住所", "group": "II. 甲 (委託者)", "type": "textarea", "required": true}, {"name": "PARTY_A_REP", "label": "甲 (委託者) 代表者", "group": "II. 甲 (委託者)", "required": true}, {"name": "VENDOR_IS_CORPORATION", "label": "乙 種別", "group": "III. 乙 (受託者)", "type": "select", "options": ["法人", "個人"], "required": true, "helpText": "法人=商号+代表者を表示 / 個人=氏名のみ。[取引先] ボタンで vendor.entity_type から自動判定"}, {"name": "VENDOR_NAME", "label": "乙 (受託者) 商号 / 氏名", "group": "III. 乙 (受託者)", "required": true, "helpText": "[自社] または [取引先] ボタンで自動入力。法人=商号、個人=氏名"}, {"name": "VENDOR_ADDRESS", "label": "乙 (受託者) 住所", "group": "III. 乙 (受託者)", "type": "textarea", "required": true}, {"name": "VENDOR_REP", "label": "乙 (受託者) 代表者", "group": "III. 乙 (受託者)", "required": true, "helpText": "法人の場合のみ必須。「代表取締役 山田太郎」のような肩書込みの形式。個人を選択すると非表示になります"}, {"name": "VENDOR_PHONE", "label": "乙 (受託者) TEL", "group": "III. 乙 (受託者)"}, {"name": "VENDOR_EMAIL", "label": "乙 (受託者) E-mail", "group": "III. 乙 (受託者)"}, {"name": "BANK_NAME", "label": "銀行名", "group": "IV. 振込先銀行口座 (乙)", "helpText": "[取引先] ボタンで自動入力"}, {"name": "BRANCH_NAME", "label": "支店名", "group": "IV. 振込先銀行口座 (乙)"}, {"name": "ACCOUNT_TYPE", "label": "口座種別", "group": "IV. 振込先銀行口座 (乙)", "type": "select", "options": ["普通", "当座"]}, {"name": "ACCOUNT_NUMBER", "label": "口座番号", "group": "IV. 振込先銀行口座 (乙)"}, {"name": "ACCOUNT_HOLDER_KANA", "label": "口座名義 (カナ)", "group": "IV. 振込先銀行口座 (乙)"}, {"name": "IS_INVOICE_ISSUER", "label": "適格請求書発行事業者 (該当/非該当)", "group": "V. インボイス制度関連", "placeholder": "該当 / 非該当"}, {"name": "invoiceRegistrationDisplay", "label": "登録番号 (T-)", "group": "V. インボイス制度関連", "helpText": "[取引先] ボタンで自動入力 (T プレフィクス付与)"}, {"name": "CONTRACT_PERIOD_SUMMARY", "label": "契約期間", "group": "V. インボイス制度関連", "placeholder": "例: 契約締結日から1年間（期間満了1か月前までの解約通知がない場合は同一条件で1年間更新）"}, {"name": "REMARKS", "label": "特約・特記事項", "group": "VI. 特約 (任意)", "type": "textarea", "helpText": "未入力なら PDF に該当ブロックが表示されません"}, {"name": "NOTICE_CONTACT_NAME", "type": "text", "label": "通知先 担当者", "group": "VII. 通知先 (乙)", "helpText": "本契約上の通知の宛先(相手方の担当者)"}, {"name": "NOTICE_CONTACT_PHONE", "type": "text", "label": "通知先 電話", "group": "VII. 通知先 (乙)"}, {"name": "NOTICE_CONTACT_EMAIL", "type": "text", "label": "通知先 メール", "group": "VII. 通知先 (乙)"}]$schema_service_master$::jsonb, '通知先カテゴリ整備+個別契約優先の但し書き (0048)', 'migration-0048'
    FROM t RETURNING id, template_id)
UPDATE document_templates dt SET current_version_id=nv.id, updated_at=now() FROM nv WHERE dt.id=nv.template_id;

-- ===== license_master =====
WITH t AS (SELECT id FROM document_templates WHERE template_key='license_master'), nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT t.id, COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id=t.id),0)+1,
         $html_license_master$<!DOCTYPE html>
<html lang="ja">
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ライセンス利用許諾基本契約書 - {{CONTRACT_NO}}</title>
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

    .doc-header .header-separator { color: #aaa; }

    .revision-notice {
      margin: 0.25em 0 0.9em;
      padding: 0.35em 0.75em;
      border: 0.8pt solid #b8a05a;
      color: #6f5600;
      background: #fffdf2;
      font-size: 8.8pt;
      font-weight: bold;
      text-align: center;
      letter-spacing: 0.03em;
    }

    /* ===== タイトル ===== */
    h1.contract-title {
      text-align: center;
      font-size: 14pt;
      font-weight: bold;
      letter-spacing: 0.28em;
      margin-bottom: 0.9em;
      text-decoration: underline;
      text-underline-offset: 0.22em;
    }

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
      text-align: justify;
    }

    .article { margin-bottom: 0.9em; page-break-inside: auto; }
    .article-title {
      font-weight: bold;
      font-size: 10pt;
      margin-bottom: 0.15em;
      page-break-after: avoid;
    }

    .clause {
      margin-left: 0;
      margin-bottom: 0.35em;
      text-align: justify;
      page-break-inside: auto;
    }

    .clause-content { padding-left: 1.5em; text-indent: -1.5em; }

    .sub-clause {
      margin-left: 1.5em;
      padding-left: 2em;
      text-indent: -2em;
      margin-bottom: 0.25em;
      text-align: justify;
      page-break-inside: auto;
    }

    .margin-note {
      text-align: center;
      margin: 1.5em 0 2em;
      font-size: 9pt;
      color: #666;
    }

    @media print {
      body { background-color: #fff; padding: 0; }
      .contract-document {
        box-shadow: none;
        margin: 0;
        width: 100%;
        max-width: none;
        padding: 0;
      }
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

  {{#if isReissue}}
  {{#unless (eq showReissueBanner false)}}
  <div class="revision-notice">再発行版 (Rev. {{REVISION}}) — 元契約書: {{BASE_DOC_NO}}</div>
  {{/unless}}
  {{/if}}

  <h1 class="contract-title">ライセンス利用許諾基本契約書</h1>

  <!-- ======================================================
       頭書き（当事者目録・契約条件一覧）
       ====================================================== -->
  <table class="tobogaki">
    <tbody>
      <!-- 当事者 -->
      <tr class="sec-row"><td colspan="2">当　事　者</td></tr>
      <tr>
        <td class="col-item">甲（ライセンサー）</td>
        <td class="col-value">
          {{VENDOR_ADDRESS}}<br>
          {{VENDOR_NAME}}<br>
          {{VENDOR_REP}}
        </td>
      </tr>
      <tr>
        <td class="col-item">乙（ライセンシー）</td>
        <td class="col-value">
          {{PARTY_A_ADDRESS}}<br>
          {{PARTY_A_NAME}}<br>
          {{PARTY_A_REP}}
        </td>
      </tr>

      <!-- 基本条件 -->
      <tr class="sec-row"><td colspan="2">基　本　条　件</td></tr>
      <tr>
        <td class="col-item">
          原著作物・対象製品<span class="art-ref">（第1条・第2条・別紙）</span>
          <span class="sub-note">個別の対象作品・対象アナログゲームは別紙で定める</span>
        </td>
        <td class="col-value">別紙個別利用許諾条件に定めるとおり</td>
      </tr>
      <tr>
        <td class="col-item">
          許諾範囲<span class="art-ref">（第4条〜第6条）</span>
          <span class="sub-note">製造・販売・販促・サブライセンス等の具体的条件</span>
        </td>
        <td class="col-value">別紙個別利用許諾条件に定める範囲に限る</td>
      </tr>
      <tr>
        <td class="col-item">
          契約期間<span class="art-ref">（第8条）</span>
          <span class="sub-note">更新・終了後措置は本文の定めによる</span>
        </td>
        <td class="col-value">{{CONTRACT_PERIOD_SUMMARY}}</td>
      </tr>
      <tr>
        <td class="col-item">
          旧契約の取扱い<span class="art-ref">（第20条）</span>
          <span class="sub-note">旧契約を包括統合する場合の処理</span>
        </td>
        <td class="col-value">別紙個別利用許諾条件に記載された原著作物に関する旧契約がある場合、本文の定めに従う</td>
      </tr>

      <!-- 対価・支払・税務 -->
      <tr class="sec-row"><td colspan="2">対　価・支　払・税　務</td></tr>
      <tr>
        <td class="col-item">
          ロイヤリティ・対価<span class="art-ref">（第7条・別紙）</span>
          <span class="sub-note">料率・算定方法・計算期間は別紙により定める</span>
        </td>
        <td class="col-value">別紙個別利用許諾条件に定めるとおり</td>
      </tr>
      <tr>
        <td class="col-item">
          振込先銀行口座<span class="art-ref">（第7条）</span>
          <span class="sub-note">ロイヤリティ等の支払先</span>
        </td>
        <td class="col-value">
          {{BANK_NAME}}　{{BRANCH_NAME}}<br>
          {{ACCOUNT_TYPE}}　{{ACCOUNT_NUMBER}}<br>
          口座名義（カナ）：{{ACCOUNT_HOLDER_KANA}}
        </td>
      </tr>
      <tr>
        <td class="col-item">
          インボイス制度関連<span class="art-ref">（第7条）</span>
          <span class="sub-note">適格請求書発行事業者の登録状況</span>
        </td>
        <td class="col-value">
          適格請求書発行事業者：{{invoiceLabel IS_INVOICE_ISSUER}}<br>
          登録番号：{{invoiceRegistrationDisplay}}
        </td>
      </tr>

      <!-- 管轄 -->
      <!-- 通知先 -->
      <tr class="sec-row"><td colspan="2">通　知　先</td></tr>
      <tr>
        <td class="col-item">ライセンサー（甲）通知先<span class="art-ref">（第23条）</span><br><span class="sub-note">本契約上の通知の宛先</span></td>
        <td class="col-value">
          担当者：{{NOTICE_CONTACT_NAME}}<br>
          電話：{{NOTICE_CONTACT_PHONE}}<br>
          E-mail：{{NOTICE_CONTACT_EMAIL}}
        </td>
      </tr>
      <tr>
        <td class="col-item">ライセンシー（乙）通知先<span class="art-ref">（第23条）</span><br><span class="sub-note">当社担当者（頭書きの担当者情報を引用）</span></td>
        <td class="col-value">
          担当者：{{STAFF_NAME}}<br>
          電話：{{STAFF_PHONE}}<br>
          E-mail：{{STAFF_EMAIL}}
        </td>
      </tr>
      <tr class="sec-row"><td colspan="2">準　拠　法・管　轄</td></tr>
      <tr>
        <td class="col-item">準拠法・合意管轄<span class="art-ref">（第21条）</span></td>
        <td class="col-value">日本法／東京地方裁判所（第一審専属）</td>
      </tr>

      <!-- 特記事項 -->
      {{#if HAS_REMARKS}}
      <tr class="sec-row"><td colspan="2">特　記　事　項</td></tr>
      <tr>
        <td colspan="2" class="special-cell">{{REMARKS}}</td>
      </tr>
      {{/if}}
    </tbody>
  </table>

  <!-- 頭書き下部署名欄 -->
  <div class="head-signature">
    <div class="sig-date">{{CONTRACT_DATE}}</div>
    <div class="sig-grid">
      <div class="sig-party">
        <div class="party-label">甲（ライセンサー）</div>
        <div>{{VENDOR_ADDRESS}}</div>
        <div>{{VENDOR_NAME}}</div>
        <div class="sig-name-row">
          <span>{{VENDOR_REP}}</span>
          <span class="stamp-box">印</span>
        </div>
      </div>
      <div class="sig-party">
        <div class="party-label">乙（ライセンシー）</div>
        <div>{{PARTY_A_ADDRESS}}</div>
        <div>{{PARTY_A_NAME}}</div>
        <div class="sig-name-row">
          <span>{{PARTY_A_REP}}</span>
          <span class="stamp-box">印</span>
        </div>
      </div>
    </div>
  </div>

  <p class="preamble">ライセンサーである{{VENDOR_NAME}}（以下「甲」という。）とライセンシーである{{PARTY_A_NAME}}（以下「乙」という。）は、甲が保有する原著作物に係る著作権の利用に関し、以下のとおりライセンス利用許諾基本契約（以下「本契約」という。）を締結する。</p>

  <div class="article">
    <div class="article-title">第1条（目的）</div>
    <div class="clause clause-content">1. 本契約は、甲が保有する別紙個別利用許諾条件に定める原著作物に係る知的財産権について、乙によるアナログゲームとしての企画、開発、製造、販売、販促等の商業的利用を許諾するにあたり、その利用条件および当事者間の権利義務関係を定めることを目的とする。</div>
  </div>

  <div class="article">
    <div class="article-title">第2条（定義）</div>
    <div class="clause clause-content">1. 本契約における用語の定義は、以下のとおりとする。</div>
    <div class="sub-clause">（1）「原著作物」とは、甲が著作権（著作権法第27条および第28条に基づく権利を含む）、意匠権、商標権、著作隣接権、パブリシティ権その他の知的財産権（法的に保護されうる無体財産を含む）を有する、アニメーション、ゲーム、イラスト、物語、キャラクター、世界観、デザイン、設定、ならびにアナログゲームにおけるルール説明書、カードデザイン、コンポーネント等の創作性のある表現を含む創作物をいう。なお、甲が契約締結時点または将来において正当に権利を保有する、当該原著作物に由来するすべての関連作品および関連素材を含むものとする。</div>
    <div class="sub-clause">（2）「アナログゲーム」とは、カードゲーム、ボードゲーム、ダイスゲーム、テーブルトークRPG（TRPG）、紙とペンを用いるゲーム等、主として電力を必要とせずにプレイされる非デジタル形式のゲーム製品をいう。なお、これらのアナログゲームを元に構成されたゲーム内容・システム・世界観等を基に、Webブラウザ、スマートフォンアプリ、PCソフトウェア、家庭用・携帯用ゲーム機向けソフトウェア等のデジタルプラットフォーム上に実装・提供される形式（以下「デジタル実装」という。）についても、本契約においてアナログゲームの派生物として含まれるものとする。また、本契約において「アナログゲーム」には、かかるデジタル実装を含む一連の派生的なゲーム展開を含むものとし、単体での販売・提供を目的とした商業用デジタルゲーム（スマートフォンアプリ等を含む）も含まれるものとする。</div>
    <div class="sub-clause">（3）「対象アナログゲーム」とは、甲が保有する原著作物を基にして、乙が企画、開発、製造、販売、またはデジタル実装（スマートフォンアプリ、PCソフトウェア、Webブラウザゲーム等を含むがこれらに限られない）を行う、アナログゲームまたはその派生的製品であって、甲が本契約に基づき利用を許諾するものをいう。</div>
    <div class="sub-clause">（4）「二次著作物」とは、原著作物を素材として乙が創作した新たな著作物であり、翻案・翻訳・視覚表現（イラスト・キャラクター等）・ルール記載等、著作権法上の保護対象となるものを含む。</div>
    <div class="sub-clause">（5）「乙制作素材」とは、乙が対象アナログゲームの製造、販売、または翻訳・ローカライズ等にあたり、独自に制作し、または第三者に委託して制作した情報、データ、部品、素材等のうち、二次著作物に該当しないものを含む一切の資料、コンポーネント、記録等をいう。</div>
    <div class="sub-clause">（6）「ライセンス種別」とは、本契約において乙に許諾される原著作物の利用権の性質をいい、別紙個別利用許諾条件にて定める「非独占的」「専属的」「独占的」のいずれかの形態を含む。</div>
    <div class="sub-clause">（7）「許諾地域」とは、本契約に基づき乙による原著作物の利用が認められる国または地域をいい、別紙個別利用許諾条件に明記されるものとする。</div>
    <div class="sub-clause">（8）「甲の監修」とは、対象アナログゲームの製造または販促に際し、原著作物の表現内容、外装、コンポーネント、ルール記載その他に関して、甲が確認・指摘を行う権利をいう。</div>
    <div class="sub-clause">（9）「サブライセンス契約」とは、乙が本契約第5条に基づき第三者に対して再許諾を行う際に締結する契約をいう。</div>
  </div>

  <div class="article">
    <div class="article-title">第3条（個別条件の成立）</div>
    <div class="clause clause-content">1. 別紙個別利用許諾条件に定める原著作物に係る利用許諾条件は、それぞれ個別に定めるもの（以下「個別条件」という。）とし、甲および乙の合意のうえ、当該内容が別紙に記載された時点で効力を生ずるものとする。なお、別紙の形式は書面または電磁的方法による記録を含むものとし、両当事者の確認が取れたものを有効な個別条件とみなす。</div>
    <div class="clause clause-content">2. 甲および乙は、対象アナログゲームの開発等を円滑に開始する必要がある場合において、利用許諾料その他の商業条件が未確定であるときでも、当該個別条件に「本件は暫定的利用許諾に基づくものである」旨を明記することにより、暫定的な利用許諾が成立することを認める。</div>
    <div class="clause clause-content">3. 前項の暫定的利用許諾に係る個別条件には、解除条件または解除期限を明記することができるものとし、甲乙はこれを誠実に協議のうえ運用するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第4条（権利の許諾）</div>
    <div class="clause clause-content">1. 甲は乙に対し、本契約の条件に従い、原著作物に係る知的財産権について、対象アナログゲームの製造、販売および販促を目的とした利用を許諾（以下「本許諾」という。）する。</div>
    <div class="clause clause-content">2. 本許諾には、乙が当該目的のために原著作物に係る著作権（著作権法第21条から第28条に基づく複製、公衆送信、展示、頒布、翻案および二次的著作物の利用を含む）を利用する行為が含まれるものとし、その具体的条件は別紙個別利用許諾条件に定める。</div>
  </div>

  <div class="article">
    <div class="article-title">第5条（サブライセンス）</div>
    <div class="clause clause-content">1. 乙は、甲の書面による事前の承諾を得た場合に限り、本契約に基づき許諾された利用行為の全部または一部について、第三者に対し再許諾（以下「サブライセンス」という。）を行うことができる。なお、サブライセンスには、以下の2種類を含むものとする。</div>
    <div class="sub-clause">（1）国内・海外パブリッシャーへの再許諾：乙が国内または海外における販売・流通を目的として第三者（以下「パブリッシャー」という。）に対して行うサブライセンス。</div>
    <div class="sub-clause">（2）OEM委託者への再許諾：乙が第三者（以下「OEM委託者」という。）に対し、本契約に基づく著作権の一部を利用して、製品の製造・供給等を委託する場合に行うサブライセンス。</div>
    <div class="clause clause-content">2. 乙が前項のいずれかのサブライセンスを行う場合には、当該第三者とのサブライセンス契約において、本契約に定める条件と同等以上の義務を当該第三者に課すものとし、乙は当該第三者の行為について甲に対して責任を負うものとする。なお、サブライセンスにより乙が受領する対価（以下「サブライセンス料」という。）の料率、支払方法、支払期限その他条件は、別紙個別利用許諾条件に定めるとおりとする。</div>
    <div class="clause clause-content">3. 乙は、「個別利用許諾条件」に定める方法に従い、甲に対してサブライセンス料を支払うものとする。「個別利用許諾条件」に定めのない事項または変更が必要な場合は、甲乙協議の上、書面にて別途合意するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第6条（開発、製造および販売）</div>
    <div class="clause clause-content">1. 乙は、対象アナログゲームに関する企画、設計、翻案、ルール構築、ローカライズ等の開発行為（以下「開発行為」という。）を、自己の責任および費用において行うものとする。開発行為に関して、甲の協力または監修が必要な場合には、甲乙協議のうえ、別途定める方法で対応するものとする。</div>
    <div class="clause clause-content">2. 乙は、開発行為の一部または全部について、甲に対し、イラスト制作、キャラクターデザイン、グラフィック素材の作成等の業務、対象アナログゲームに関するプロモーション活動の一環として開催される販促イベント、サイン会、登壇企画、メディア出演等（以下「受託業務」という。）を委託することができる。なお、受託業務に関する具体的な内容、納期、報酬、成果物の知的財産権の取扱い等については、甲乙協議のうえ、書面またはそれに準ずる方法（発注書、電子メール等による合意を含む）により定めるものとする。</div>
    <div class="clause clause-content">3. 前項において、甲が制作した成果物（以下「委託成果物」という。）に関する知的財産権のうち、甲が委託業務以前より保有していた従前の知的財産権は甲に帰属するものとする。一方で、委託業務の遂行により新たに創作された部分に係る知的財産権（翻案、加工、追加表現等を含む）は、特段の定めがない限り乙に譲渡されるものとする。なお、従前の知的財産権が委託成果物を構成する上で不可分かつ本質的な要素を構成する場合であって、乙が本契約に基づく目的の範囲で当該成果物を利用する際、甲乙間に別段の合意がない限り、甲は乙に対し、当該従前の知的財産権を非独占的に利用許諾するものとし、これらの利用許諾および著作権譲渡に係る対価は、当該業務委託に係る報酬にすべて含まれるものとする。</div>
    <div class="clause clause-content">4. 乙は、対象アナログゲームの製造を、自己の責任および費用において行うものとする。ただし、乙は製造に先立ち、甲に対して予定製造数量および製造開始予定日等を通知し、試作サンプルを提供するものとする。なお、別途定める個別条件において甲の監修が求められている場合には、乙は、当該サンプルについて外装、内容物、ルール、翻案要素等に関する甲の監修を受けるものとする。甲は合理的な範囲で確認および指摘を行うことができ、乙はその指摘に誠意をもって対応する。</div>
    <div class="clause clause-content">5. 乙は、対象アナログゲームの製造にあたり、印刷品質、資材の仕様、製品の安全性その他の品質について、甲が別途指定する基準がある場合にはこれを遵守しなければならない。また、乙は、甲が指定する著作権表示、ライセンス表記その他のクレジット情報を、甲の指示に従って製品およびパッケージ等に適切に表示しなければならない。</div>
    <div class="clause clause-content">6. 乙は、対象アナログゲームの製造について、自らの責任において第三者に再委託することができるものとする。再委託先の選定、契約条件および管理については、乙の裁量に委ねられる。</div>
    <div class="clause clause-content">7. 乙は、対象アナログゲームの販売に関して、許諾地域において、自己の裁量により販売方法、販売チャネル、価格設定等を決定できるものとする。また、乙は、自らの責任において、第三者に販売行為を委託することができる。</div>
    <div class="clause clause-content">8. 乙が個別条件に定める許諾地域において本契約に基づき対象アナログゲームを販売する場合であっても、当該商品がインターネット等を通じた越境電子商取引（越境EC）を通じて、許諾地域外の消費者により購入された結果として、当該地域外に流通することとなったときは、乙が当該海外流通を直接的に意図・助長したものでない限り、当該行為は本契約に定める許諾地域の制限に違反するものとはみなさない。</div>
    <div class="clause clause-content">9. 乙は、販売開始に先立ち、甲に対して販売予定日、対象地域および販売方法の概要を通知しなければならない。なお、甲が合理的に調整を求めた場合、乙はこれに誠意をもって協議するものとする。</div>
    <div class="clause clause-content">10. 乙は、対象アナログゲームの製造または販売に関連して第三者との間に発生する瑕疵、クレーム、紛争その他の問題について、第一次的に対応しなければならない。必要に応じて、乙は甲と協議のうえ、これを適切に処理するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第7条（対価）</div>
    <div class="clause clause-content">1. 乙は、対象アナログゲームの利用に対して、別紙個別利用許諾条件に記載された基準価格、ロイヤリティ料率、算定方法および対象地域ごとの条件に基づき算定された金額を、甲に対する対価として支払うものとする。なお、乙が甲に対して委託業務を発注した場合、当該委託業務に関する報酬（以下「業務委託報酬」という。）については、別途甲乙間で合意した金額および支払条件に従い、支払われるものとする。また、乙が「下請代金支払遅延等防止法」または「特定受託事業者に係る取引の適正化等に関する法律（令和5年法律第29号）」、その他これに準ずる法令の適用を受ける立場にある場合には、乙は、合意された支払期限までに当該業務委託報酬の全額を支払わなければならず、これに遅れた場合には、年14.6％の割合による遅延損害金を甲に対して支払うものとする。但し、当該法令等の適用を受けない場合は、3％とする。</div>
    <div class="clause clause-content">2. ロイヤリティの算定方法は、別紙個別利用許諾条件において以下のいずれかの方式が指定されるものとする。</div>
    <div class="sub-clause">（1）製造数量に基づく方式：乙は、製造完了時点または当該製品の第三者への引渡し時点のいずれか早い時点において、製造数量に基づきロイヤリティを算出・支払う。</div>
    <div class="sub-clause">（2）売上高に基づく方式：乙は、実際の売上数量に応じたロイヤリティを、別紙個別利用許諾条件に定める計算期間および支払時期に従って支払う。</div>
    <div class="clause clause-content">3. 乙は、当該支払を履行する場合、対象期間における数量・価格・地域別売上・控除項目・算定基準等を記載した明細書を甲に提出するものとする。</div>
    <div class="clause clause-content">4. 甲は、乙の帳簿および関連書類につき、年1回を限度として合理的な方法および期間により監査を行うことができる。監査費用は原則として甲が負担するものとするが、過少支払いが判明した場合にはその費用は乙が負担するものとする。</div>
    <div class="clause clause-content">5. 本条に基づく対価の支払は、冒頭の特約・特記事項に定める甲の金融機関口座への振込によって行うものとし、当該振込をもって乙の甲に対する支払義務の履行とみなす。</div>
  </div>

  <div class="article">
    <div class="article-title">第8条（契約期間）</div>
    <div class="clause clause-content">1. 本契約の有効期間は、契約締結日から起算して5年間とする。</div>
    <div class="clause clause-content">2. 前項の期間満了の1ヶ月前までに、甲または乙いずれからも書面による更新拒絶の通知がない場合、本契約は同一条件にて5年間自動更新されるものとし、以後も同様とする。</div>
  </div>

  <div class="article">
    <div class="article-title">第9条（知的財産の帰属）</div>
    <div class="clause clause-content">1. 乙が、本契約に基づき甲の原著作物を利用して創作した翻案物、翻訳テキスト、デザイン、ルール等の著作物（以下「二次著作物」という。）に係る著作権は、乙に帰属するものとする。</div>
    <div class="clause clause-content">2. 前項の二次著作物は、本契約に定める目的および範囲に限り使用されるものとし、乙は甲の原著作物に係る権利を不当に侵害してはならない。</div>
    <div class="clause clause-content">3. 乙が対象アナログゲームの製造、販売、翻訳、ローカライズ等に関連して制作した、または第三者に制作させた著作物に該当しない素材、部品、印刷物、仕様書、プレイシート等（以下「乙制作素材」という。）については、当該素材が乙に権利帰属する場合に限り、乙に帰属するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第10条（追加作品に関する合意）</div>
    <div class="clause clause-content">1. 本契約の枠組みを適用する新たな原著作物および対象アナログゲームを追加する場合、甲乙は、予め本契約と併せて合意済の様式に基づく追加合意書を締結し、当該新作に関する情報を別紙個別利用許諾条件に追加または差替えることにより対応するものとする。</div>
    <div class="clause clause-content">2. 前項に基づく追加合意書には、対象となる原著作物名、ライセンス種別、利用範囲、許諾地域、ロイヤリティ条件、許諾期間等を明記するものとし、本契約と一体として効力を有する。</div>
    <div class="clause clause-content">3. 各追加原著作物に関する許諾期間は、原則として本契約の有効期間と同一とする。ただし、追加時点において本契約の残存期間が2年未満である場合には、本契約の自動更新がなされたことを前提に、更新後の有効期間全体を含めた期間を許諾期間とすることができるものとする。</div>
    <div class="clause clause-content">4. 本条に基づき追加された原著作物に関する利用条件その他の事項は、本契約の各条項に従って取り扱われるものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第11条（契約終了後の措置）</div>
    <div class="clause clause-content">1. 本契約が終了（期間満了、解除その他理由の如何を問わず）した場合、乙は以下の措置を講じるものとする。</div>
    <div class="sub-clause">（1）対象アナログゲームの新規製造を直ちに中止すること。</div>
    <div class="sub-clause">（2）契約終了日前に製造された在庫品については、当該在庫が消尽するまでの間、販売を継続することができる。ただし、甲が提供した原作アート等と一体的に構成された部分については、乙は甲の許諾を得た上で販売を継続するものとする。</div>
    <div class="sub-clause">（3）原著作物、原作アート、甲が提供または監修した素材、およびそれらの複製物については、甲の指示に従い返還または適切に処分すること。</div>
    <div class="clause clause-content">2. 本契約終了後, 乙が本契約に基づき制作した二次著作物または乙制作素材を再利用する場合には、当該素材が甲の原著作物または原作アートと一体的に構成されていた場合に限り、甲の書面による事前承諾を得るものとする。</div>
    <div class="clause clause-content">3. 甲は, 本契約終了時に乙と協議のうえ, 乙が本契約に基づき制作した主要な二次著作物および乙制作素材について, 相当額の対価で譲り受ける交渉を行うことができ, 乙はこれに誠実に応じるものとする。</div>
    <div class="clause clause-content">4. 乙が第三者との間で本契約に基づくサブライセンス契約を締結していた場合には, 乙の責任と費用において, 当該契約を適切に終了させる措置を講じるものとする。</div>
    <div class="clause clause-content">5. 本契約終了時点までに発生した甲乙間の権利義務（未払金の支払等）は, 契約終了後もなお存続するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第12条（解除）</div>
    <div class="clause clause-content">1. いずれかの当事者が本契約に違反し, 相手方が書面によって相当期間を定めて是正を催告したにもかかわらず, 当該期間内に是正されないときは, 相手方は本契約を解除することができる。</div>
    <div class="clause clause-content">2. 次の各号のいずれかに該当した場合には, 民法第541条および第542条第1項第4号等の規定に基づき, 相手方は催告を要せず直ちに本契約を解除することができるものとする。</div>
    <div class="sub-clause">（1）支払停止, 手形又は小切手の不渡りがあったとき</div>
    <div class="sub-clause">（2）破産, 民事再生, 会社更生, 特別清算の申立てがなされたとき, または自ら申立てを行ったとき</div>
    <div class="sub-clause">（3）営業の全部または重要な部分の譲渡, 合併, 会社分割, または清算に着手したとき</div>
    <div class="sub-clause">（4）財産について仮差押え, 差押えまたは競売の申立てがあったとき</div>
    <div class="sub-clause">（5）信用状態が著しく悪化し, 本契約の履行が困難と合理的に認められるとき</div>
    <div class="sub-clause">（6）自らまたはその役員等が反社会的勢力に該当し, または関係を有していることが判明したとき</div>
    <div class="sub-clause">（7）その他, 契約の目的を達成することが不可能または著しく困難と認められる重大な事由が生じたとき</div>
    <div class="clause clause-content">3. 本条に基づく解除は, 解除によって当事者に生じた損害について, 解除権を行使した当事者がその責任を負うものではない。ただし, 当該解除の原因が解除権者に帰責すべきものである場合はこの限りでない。</div>
  </div>

  <div class="article">
    <div class="article-title">第13条（機密保持）</div>
    <div class="clause clause-content">1. 甲および乙は, 本契約の締結および履行に関連して相手方から開示された, 秘密である旨を明示された技術上または営業上の情報（以下「秘密情報」という。）を, 第三者に開示または漏洩せず, 本契約の目的以外には使用しないものとする。</div>
    <div class="clause clause-content">2. 前項の規定は, 本契約期間中および本契約終了後3年間, 引き続き有効に存続するものとする。</div>
    <div class="clause clause-content">3. 次の各号のいずれかに該当する情報は, 秘密情報に含まれないものとする。</div>
    <div class="sub-clause">（1）開示を受けた時点ですでに公知であった情報</div>
    <div class="sub-clause">（2）開示を受けた後, 自己の責めによらず公知となった情報</div>
    <div class="sub-clause">（3）開示を受ける前から保有していた情報であることを証明できるもの</div>
    <div class="sub-clause">（4）正当な権限を有する第三者から適法に入手した情報</div>
    <div class="sub-clause">（5）相手方から開示された秘密情報によることなく, 独自に開発した情報</div>
    <div class="clause clause-content">4. 甲および乙は, 法令または裁判所その他の公的機関の命令に基づき開示を求められた場合には, 可能な限り事前に相手方に通知し, 協議のうえ対応するものとする。</div>
    <div class="clause clause-content">5. 甲および乙は, 秘密情報の取扱いに関し, 善良なる管理者の注意義務をもって厳重に管理し, 漏洩, 紛失, 盗難等の事態が発生した場合には, 直ちに相手方に通知し, 必要な措置を講じるものとする。</div>
    <div class="clause clause-content">6. 本契約の終了または相手方からの要請があった場合, 甲および乙は, 相手方から受領した秘密情報およびその複製物を, 相手方の指示に従い, 速やかに返還または廃棄するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第14条（個人情報の取扱い）</div>
    <div class="clause clause-content">1. 甲および乙は, 本契約の履行に関連して相手方または第三者の個人情報を取り扱う場合, 日本の個人情報の保護に関する法律その他の関係法令を遵守し, 適切に管理するものとする。</div>
    <div class="clause clause-content">2. 甲および乙は, 取得した個人情報を, 本契約の履行に必要な範囲を超えて利用せず, また, 第三者に提供または開示してはならない。</div>
    <div class="clause clause-content">3. 甲および乙は, 個人情報の漏洩, 滅失または毀損の防止その他の安全管理措置を講じるとともに, 事故等が発生した場合には, 速やかに相手方に報告し, 必要な措置を講じるものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第15条（権利義務の譲渡禁止）</div>
    <div class="clause clause-content">1. 甲および乙は, 相手方の書面による事前の承諾なく, 本契約に基づく一切の権利および義務を, 第三者に譲渡し, 担保に供し, または承継させてはならない。</div>
    <div class="clause clause-content">2. 前項に違反してなされた譲渡等は無効とする。</div>
  </div>

  <div class="article">
    <div class="article-title">第16条（表明保証）</div>
    <div class="clause clause-content">1. 甲は, 次の各号について, 本契約締結時点において真実かつ正確であることを表明し, 保証する。</div>
    <div class="sub-clause">（1）原著作物に関する著作権その他の必要な知的財産権を正当に保有し, 第三者の権利を侵害していないこと</div>
    <div class="sub-clause">（2）原著作物について, 第三者からの知的財産権侵害の主張, 差止, 損害賠償請求等の係争は存在せず, そのおそれもないこと。なお, 乙が本契約に基づく正当な利用により第三者との間に紛争または損害を被った場合には, 甲の責任と費用負担によりこれを解決し, 乙に生じた損害を補償すること</div>
    <div class="sub-clause">（3）本契約を締結・履行するにあたって, 自己の権限に基づいており, 第三者の承諾を要しないこと</div>
    <div class="sub-clause">（4）日本法令その他適用される法令に違反していないこと</div>
    <div class="clause clause-content">2. 乙は, 次の各号について, 本契約締結時点において真実かつ正確であることを表明し, 保証する。</div>
    <div class="sub-clause">（1）本契約を締結・履行するにあたって, 自己の権限に基づいており, 第三者の承諾を要しないこと</div>
    <div class="sub-clause">（2）日本法令その他適用される法令に違反していないこと</div>
    <div class="sub-clause">（3）契約の履行にあたり, 誠実に対応する意志と能力を有していること</div>
  </div>

  <div class="article">
    <div class="article-title">第17条（損害賠償）</div>
    <div class="clause clause-content">1. 甲および乙は, 本契約に違反し, または本契約に関連して相手方に損害を与えた場合, 当該違反当事者は, 相手方に対し, 現実に発生した直接かつ通常の範囲に属する損害（以下「通常損害」という。）に限り, その損害を賠償する責任を負うものとする。</div>
    <div class="clause clause-content">2. いかなる場合においても, 甲および乙は, 相手方に対し, 特別損害, 間接損害, 結果的損害, 逸失利益, 営業機会の喪失その他通常損害を超える損害については, 賠償責任を負わないものとする。</div>
    <div class="clause clause-content">3. ただし, 以下の場合には, 本条に定める責任の制限は適用されず, 当該当事者は相手方に生じた一切の損害について全額賠償する責任を負うものとする。</div>
    <div class="sub-clause">（1）金銭債務の不履行（支払遅延を含む）</div>
    <div class="sub-clause">（2）本契約における表明保証条項の違反</div>
    <div class="sub-clause">（3）故意または重大な過失による契約違反または不法行為</div>
  </div>

  <div class="article">
    <div class="article-title">第18条（反社会的勢力の排除）</div>
    <div class="clause clause-content">1. 甲および乙は, 現在および将来にわたり, 次のいずれにも該当しないことを表明し, 保証する。</div>
    <div class="sub-clause">（1）暴力団, 暴力団員, 暴力団関係企業, 総会屋, 社会運動等標ぼうゴロ, 特殊知能暴力集団その他これに準ずる者（以下「反社会的勢力」という。）でないこと</div>
    <div class="sub-clause">（2）反社会的勢力と関係を有していないこと</div>
    <div class="sub-clause">（3）反社会的勢力を利用しないこと</div>
    <div class="sub-clause">（4）反社会的勢力に資金等を提供しないこと</div>
    <div class="sub-clause">（5）自らまたは第三者を通じて不当な要求行為を行わないこと</div>
    <div class="clause clause-content">2. 甲または乙が前項に違反した場合, 相手方は何らの催告を要せずして本契約を直ちに解除することができる。この場合, 解除により生じた損害について, 解除された当事者は何らの賠償を請求することはできない。</div>
  </div>

  <div class="article">
    <div class="article-title">第19条（協議事項）</div>
    <div class="clause clause-content">1. 本契約に定めのない事項, または本契約条項の解釈に疑義が生じた場合には, 甲乙協議の上, 誠意をもって解決を図るものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第20条（旧契約の包括統合及び解除）</div>
    <div class="clause clause-content">1. 甲および乙は, 本契約の発効日をもって, 別紙個別利用許諾条件に記載された原著作物に関して甲乙間で従前に成立していた一切の利用許諾契約（書面, 口頭その他の形式を問わない。以下「旧契約」という。）があった場合, 当該契約の内容を本契約に包括統合し, 当該包括統合の完了と同時に旧契約を解除することに合意する。なお, 当該包括統合及び解除により, 旧契約は本契約に吸収された後に消滅し, 以後は本契約のみが当該原著作物に関する唯一の有効な契約として適用される。</div>
    <div class="clause clause-content">2. 旧契約の解除は, 本契約への包括統合を条件として行われるものであり, 当該原著作物に関する利用条件および権利義務関係に空白期間が生じることはない。</div>
    <div class="clause clause-content">3. 本契約発効日前に旧契約に基づいて既に確定した権利義務については, 本契約の枠組みの中で引き続き有効とし, 本契約の条項に従って取り扱われる。</div>
  </div>

  <div class="article">
    <div class="article-title">第21条（準拠法および合意管轄）</div>
    <div class="clause clause-content">1. 本契約の準拠法は, 日本法とする。</div>
    <div class="clause clause-content">2. 本契約に関して甲乙間に生じた紛争については, 東京地方裁判所を第一審の専属的合意管轄裁判所とする。</div>
  </div>

  <div class="article">
    <div class="article-title">第22条（存続）</div>
    <div class="clause clause-content">1. 本契約が終了した場合であっても, 本条, 第7条（対価）, 第9条（知的財産の帰属）乃至第11条（契約終了後の措置）, および第13条（機密保持）, 第21条（準拠法および合意管轄）はなお有効に存続するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第23条（通知）</div>
    <div class="clause clause-content">1. 本契約に基づく通知、承諾その他の連絡は、当事者が事前に相手方に対して指定した通知先（頭書きに記載の担当者、電話番号および電子メールアドレスを含む。）に対して、書面、電子メールその他当事者間で合意した方法により行うものとする。</div>
    <div class="clause clause-content">2. 各当事者は、自らの通知先を変更する場合、相手方に対してその旨を速やかに通知するものとし、当該通知が相手方に到達した時点以降、当該変更は有効となる。</div>
    <div class="clause clause-content">3. ただし、個別契約に本条と異なる定めがある場合は、当該個別契約の定めを優先する。</div>
  </div>

  <div class="margin-note">（以下余白）</div>

</div>

</body>
</html>
$html_license_master$, $schema_license_master$[{"name": "CONTRACT_NO", "label": "契約番号", "group": "I. ヘッダ", "dbField": "auto.docNumber", "helpText": "生成時に自動採番されます"}, {"name": "CONTRACT_DATE", "label": "契約締結日", "group": "I. ヘッダ", "type": "date", "required": true}, {"name": "VENDOR_NAME", "label": "ライセンサー名称", "group": "II. ライセンサー (許諾者)", "required": true, "helpText": "[自社] または [取引先] ボタンで自動入力"}, {"name": "VENDOR_ADDRESS", "label": "ライセンサー住所", "group": "II. ライセンサー (許諾者)", "type": "textarea", "required": true}, {"name": "VENDOR_REP", "label": "ライセンサー代表者", "group": "II. ライセンサー (許諾者)", "required": true}, {"name": "VENDOR_PHONE", "label": "TEL", "group": "II. ライセンサー (許諾者)"}, {"name": "VENDOR_EMAIL", "label": "E-mail", "group": "II. ライセンサー (許諾者)"}, {"name": "PARTY_A_NAME", "label": "ライセンシー名称", "group": "III. ライセンシー (被許諾者)", "required": true, "helpText": "[自社] または [取引先] ボタンで自動入力"}, {"name": "PARTY_A_ADDRESS", "label": "ライセンシー住所", "group": "III. ライセンシー (被許諾者)", "type": "textarea", "required": true}, {"name": "PARTY_A_REP", "label": "ライセンシー代表者", "group": "III. ライセンシー (被許諾者)", "required": true}, {"name": "BANK_NAME", "label": "金融機関名", "group": "IV. 振込先口座 (ロイヤリティ送金先)", "helpText": "通常はライセンサーの口座"}, {"name": "BRANCH_NAME", "label": "支店名", "group": "IV. 振込先口座 (ロイヤリティ送金先)"}, {"name": "ACCOUNT_TYPE", "label": "口座種別", "group": "IV. 振込先口座 (ロイヤリティ送金先)", "type": "select", "options": ["普通", "当座"]}, {"name": "ACCOUNT_NUMBER", "label": "口座番号", "group": "IV. 振込先口座 (ロイヤリティ送金先)"}, {"name": "ACCOUNT_HOLDER_KANA", "label": "口座名義 (カナ)", "group": "IV. 振込先口座 (ロイヤリティ送金先)"}, {"name": "IS_INVOICE_ISSUER", "label": "適格請求書発行事業者", "group": "IV. 振込先口座 (ロイヤリティ送金先)", "type": "boolean"}, {"name": "invoiceRegistrationDisplay", "label": "インボイス登録番号 (T-)", "group": "IV. 振込先口座 (ロイヤリティ送金先)", "helpText": "IS_INVOICE_ISSUER が true の場合に表示"}, {"name": "CONTRACT_PERIOD_SUMMARY", "label": "契約期間", "group": "IV. 振込先口座 (ロイヤリティ送金先)", "placeholder": "例: 契約締結日から5年間（期間満了1か月前までの更新拒絶通知がない場合は同一条件で5年間更新）"}, {"name": "HAS_REMARKS", "label": "備考あり", "group": "V. 備考 (任意)", "type": "boolean"}, {"name": "REMARKS", "label": "備考", "group": "V. 備考 (任意)", "type": "textarea", "helpText": "HAS_REMARKS が true の場合に表示"}, {"name": "documentNumberOverride", "label": "契約番号 手動上書き (任意)", "group": "VI. 発行オプション (任意)", "helpText": "空欄なら自動採番。社内修正版を外部に出す場合、再発行リビジョン (_001 等) ではなく任意の番号を指定可能 (例: 元番号 ARC-LIC-2026-0001 をそのまま使い続ける)"}, {"name": "showReissueBanner", "label": "PDF に再発行版バナーを表示", "group": "VI. 発行オプション (任意)", "type": "boolean", "helpText": "ON (デフォルト): 再発行版のとき PDF に黄色バナーを表示。OFF: 社内修正のみで相手方には初版に見せたいとき。リビジョン番号は DB 側で常に管理されます"}, {"name": "NOTICE_CONTACT_NAME", "type": "text", "label": "通知先 担当者", "group": "VII. 通知先 (相手方)", "helpText": "本契約上の通知の宛先(相手方の担当者)"}, {"name": "NOTICE_CONTACT_PHONE", "type": "text", "label": "通知先 電話", "group": "VII. 通知先 (相手方)"}, {"name": "NOTICE_CONTACT_EMAIL", "type": "text", "label": "通知先 メール", "group": "VII. 通知先 (相手方)"}]$schema_license_master$::jsonb, '通知先カテゴリ整備+個別契約優先の但し書き (0048)', 'migration-0048'
    FROM t RETURNING id, template_id)
UPDATE document_templates dt SET current_version_id=nv.id, updated_at=now() FROM nv WHERE dt.id=nv.template_id;

-- ===== pub_master_individual =====
WITH t AS (SELECT id FROM document_templates WHERE template_key='pub_master_individual'), nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT t.id, COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id=t.id),0)+1,
         $html_pub_master_individual$<!DOCTYPE html>
<html lang="ja">
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>出版等許諾基本契約書（個人版） - {{契約番号}}</title>
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
    }
    .contract-document {
      max-width: 210mm;
      margin: 0 auto;
      background-color: #fff;
      padding: 18mm 20mm 22mm 25mm;
    }
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
    .doc-header .header-separator { color: #aaa; }
    .revision-notice {
      margin: 0.25em 0 0.9em;
      padding: 0.35em 0.75em;
      border: 0.8pt solid #b8a05a;
      color: #6f5600;
      background: #fffdf2;
      font-size: 8.8pt;
      font-weight: bold;
      text-align: center;
      letter-spacing: 0.03em;
    }
    h1.contract-title {
      text-align: center;
      font-size: 14pt;
      font-weight: bold;
      letter-spacing: 0.28em;
      margin-bottom: 0.3em;
      text-decoration: underline;
      text-underline-offset: 0.22em;
    }
    .contract-subtitle {
      text-align: center;
      font-size: 9pt;
      color: #444;
      margin-bottom: 1em;
      letter-spacing: 0.12em;
    }
    .tobogaki {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.15em;
      font-size: 9pt;
      line-height: 1.6;
      border-top: 1.5pt solid #1a1a1a;
      border-bottom: 1.5pt solid #1a1a1a;
    }
    .tobogaki th, .tobogaki td {
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
    }
    .tobogaki .col-item {
      width: 36%;
      font-weight: bold;
      color: #1a1a1a;
      padding-left: 0.5em;
    }
    .tobogaki .col-item .art-ref { font-size: 7.5pt; font-weight: normal; color: #777; }
    .tobogaki .col-item .sub-note {
      display: block;
      font-size: 7.5pt;
      font-weight: normal;
      color: #888;
      margin-top: 0.1em;
    }
    .tobogaki .col-value { width: 64%; word-break: break-all; overflow-wrap: break-word; color: #1a1a1a; }
    .tobogaki .special-cell { min-height: 2.5em; word-break: break-all; overflow-wrap: break-word; color: #1a1a1a; white-space: pre-wrap; }
    .head-signature { margin: 0.2em 0 1.3em; page-break-inside: avoid; font-size: 9.2pt; line-height: 1.55; }
    .head-signature .sig-date { text-align: right; margin-bottom: 0.8em; }
    .head-signature .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2em; }
    .head-signature .sig-party { border-top: 1pt solid #1a1a1a; padding-top: 0.5em; }
    .head-signature .party-label { font-weight: bold; margin-bottom: 0.3em; }
    .head-signature .sig-name-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8em; margin-top: 0.3em; }
    .head-signature .stamp-box { width: 52px; height: 52px; border: 1pt solid #1a1a1a; display: flex; justify-content: center; align-items: center; font-size: 11pt; background-color: #fff; flex-shrink: 0; }
    .preamble { font-size: 9.5pt; text-indent: 1em; margin-bottom: 0.9em; line-height: 1.7; text-align: justify; }
    .article { margin-bottom: 0.9em; page-break-inside: auto; }
    .article-title { font-weight: bold; font-size: 10pt; margin-bottom: 0.15em; page-break-after: avoid; }
    .clause { margin-left: 0; margin-bottom: 0.35em; text-align: justify; page-break-inside: auto; }
    .clause-content { padding-left: 1.5em; text-indent: -1.5em; }
    .sub-clause { margin-left: 1.5em; padding-left: 2em; text-indent: -2em; margin-bottom: 0.25em; text-align: justify; page-break-inside: auto; }
    .margin-note { text-align: center; margin: 1.5em 0 2em; font-size: 9pt; color: #666; }
    @media print {
      body { background-color: #fff; }
      .contract-document { box-shadow: none; margin: 0; width: 100%; max-width: none; padding: 0; }
      .head-signature, .tobogaki { page-break-inside: avoid; }
      p { orphans: 3; widows: 3; }
    }

  </style>
</head>
<body>
<div class="contract-document">

  <div class="doc-header">
    <span class="header-item">締結日：{{契約締結日}}</span>
    <span class="header-separator">｜</span>
    <span class="header-item">契約番号：{{契約番号}}</span>
  </div>

  {{#if 再発行フラグ}}
  <div class="revision-notice">再発行版 (Rev. {{改訂番号}}) — 元契約書: {{元契約番号}}</div>
  {{/if}}

  <h1 class="contract-title">出版等許諾基本契約書</h1>
  <div class="contract-subtitle">個人版（二次利用条項付き）</div>

  <table class="tobogaki">
    <tbody>

      <tr class="sec-row"><td colspan="2">当　事　者</td></tr>
      <tr>
        <td class="col-item">許諾者</td>
        <td class="col-value">
          {{許諾者住所}}<br>
          {{許諾者氏名}}
        </td>
      </tr>
      <tr>
        <td class="col-item">被許諾者</td>
        <td class="col-value">
          {{アークライト住所}}<br>
          株式会社アークライト<br>
          代表取締役　{{アークライト代表者氏名}}
        </td>
      </tr>

      <tr class="sec-row"><td colspan="2">許　諾　条　件</td></tr>
      <tr>
        <td class="col-item">
          許諾範囲<span class="art-ref">（第３条・第４条・別紙）</span>
          <span class="sub-note">具体的条件・対象著作物・許諾地域は別紙個別契約による</span>
        </td>
        <td class="col-value">出版許諾：紙媒体・電子書籍（第３条）<br>二次利用許諾：翻訳・翻案等（第４条）<br>商品化・映像化・デジタルゲーム化等は、追加条件書、覚書その他の書面で明示した場合に限り許諾</td>
      </tr>
      <tr>
        <td class="col-item">
          著作権利用料（印税）<span class="art-ref">（第１５条・別紙）</span>
          <span class="sub-note">料率・算定根拠・支払期日は別紙個別契約による</span>
        </td>
        <td class="col-value">別紙個別契約に定めるとおり</td>
      </tr>
      <tr>
        <td class="col-item">
          振込先口座<span class="art-ref">（第１５条）</span>
          <span class="sub-note">許諾者が指定する金融機関口座</span>
        </td>
        <td class="col-value">
          {{振込先銀行名}}　{{支店名}}<br>
          {{口座種別}}　{{口座番号}}<br>
          口座名義（カナ）：{{口座名義カナ}}
        </td>
      </tr>
      <tr>
        <td class="col-item">
          インボイス制度<span class="art-ref">（第１５条第５項・第６項）</span>
          <span class="sub-note">適格請求書発行事業者の登録状況</span>
        </td>
        <td class="col-value">
          適格請求書発行事業者：{{インボイス登録状況}}<br>
          登録番号：{{インボイス登録番号}}
        </td>
      </tr>

      <!-- 通知先 -->
      <tr class="sec-row"><td colspan="2">通　知　先</td></tr>
      <tr>
        <td class="col-item">許諾者（甲）通知先<span class="art-ref">（第３２条）</span><br><span class="sub-note">本契約上の通知の宛先</span></td>
        <td class="col-value">
          担当者：{{通知先担当者}}<br>
          電話：{{通知先電話}}<br>
          メール：{{通知先メール}}
        </td>
      </tr>
      <tr>
        <td class="col-item">被許諾者（乙）通知先<span class="art-ref">（第３２条）</span><br><span class="sub-note">当社担当者（頭書きの担当者情報を引用）</span></td>
        <td class="col-value">
          担当者：{{STAFF_NAME}}<br>
          電話：{{STAFF_PHONE}}<br>
          メール：{{STAFF_EMAIL}}
        </td>
      </tr>
      <tr class="sec-row"><td colspan="2">準　拠　法・管　轄</td></tr>
      <tr>
        <td class="col-item">準拠法・合意管轄<span class="art-ref">（第３０条）</span></td>
        <td class="col-value">日本法／東京地方裁判所（第一審専属）</td>
      </tr>

      <tr class="sec-row"><td colspan="2">特　記　事　項</td></tr>
      <tr>
        <td colspan="2" class="special-cell">{{特記事項}}</td>
      </tr>
    </tbody>
  </table>


  <div class="head-signature">
    <div class="sig-date">{{契約締結日}}</div>
    <div class="sig-grid">
      <div class="sig-party">
        <div class="party-label">許諾者</div>
        <div>{{許諾者住所}}</div>
        <div class="sig-name-row">
          <span>{{許諾者氏名}}</span>
          <span class="stamp-box">印</span>
        </div>
      </div>
      <div class="sig-party">
        <div class="party-label">被許諾者</div>
        <div>{{アークライト住所}}</div>
        <div>株式会社アークライト</div>
        <div class="sig-name-row">
          <span>代表取締役　{{アークライト代表者氏名}}</span>
          <span class="stamp-box">印</span>
        </div>
      </div>
    </div>
  </div>

  <p class="preamble">{{許諾者氏名}}（以下「許諾者」という）と株式会社アークライト（以下「被許諾者」という）は、許諾者が著作権を保有する著作物の出版等に関する基本的な取引条件を定めるため、以下のとおり出版等許諾基本契約書（以下「本基本契約」という）を締結する。</p>


  <div class="article">
    <div class="article-title">第１条　（定義）</div>
    <div class="clause clause-content">　本基本契約において、以下の用語は以下の意味を有するものとする。</div>
    <div class="sub-clause">（1）　「個別契約」とは、本基本契約に基づき、被許諾者と許諾者との間で個別の著作物ごとに締結される利用許諾条件書をいう。</div>
    <div class="sub-clause">（2）　「本著作物」とは、各個別契約において特定された著作物をいう。</div>
    <div class="sub-clause">（3）　「本出版物」とは、本著作物に基づき被許諾者が制作・発行する出版物（電子書籍を含む）をいう。</div>
    <div class="sub-clause">（4）　「技術的保護手段（DRM）」とは、著作権法第２条第１項第20号に定める技術的保護手段をいい、電子書籍の不正複製・不正配布を防止するためにコンテンツデータに適用される電子的手段をいう。</div>
    <div class="sub-clause">（5）　「配信プラットフォーム」とは、電子書籍の配信・販売を行う事業者が運営するオンラインサービスおよびそのシステムをいう。</div>
    <div class="sub-clause">（6）　「電子書籍」とは、本著作物に基づき被許諾者が制作・配信するデジタルコンテンツであって、スマートフォン・タブレット端末・電子書籍専用端末・PCその他の汎用情報端末向けの電子書籍ストアまたは電子書籍専用アプリを通じて配信されるものをいう。家庭用ゲーム機・ゲームコンソール・ゲームプラットフォームその他のゲーム専用システムを通じた配信は、本定義における「電子書籍」に含まない。</div>
  </div>

  <div class="article">
    <div class="article-title">第２条　（個別契約との関係）</div>
    <div class="clause clause-content">　被許諾者と許諾者は、本基本契約に基づき、個別の著作物ごとに個別契約を締結するものとする。</div>
    <div class="clause clause-content">２　個別契約は本基本契約の一部を構成する。本基本契約と個別契約との間に矛盾または相違がある場合は、別段の定めがない限り、個別契約の定めが優先するものとする。</div>
    <div class="clause clause-content">３　本基本契約は、個別契約が締結された場合に、当該個別契約に係る著作物の利用について効力を生じる。</div>
  </div>

    <div class="article">
    <div class="article-title">第３条　（出版の許諾）</div>
    <div class="clause clause-content">　許諾者は、被許諾者に対し、個別契約に定める条件の下で、本著作物について以下の各号に定める権利を独占的に許諾する。</div>
    <div class="sub-clause">（1）　印刷媒体を用いた出版物（オンデマンド印刷を含む。以下「紙媒体出版物」という）として複製し、頒布すること（著作権法第21条・第26条の2）</div>
    <div class="sub-clause">（2）　電子書籍（第１条第６号に定めるものをいう）の複製・公衆送信（送信可能化を含む）（著作権法第21条・第23条）（個別契約において電子書籍出版を許諾すると定めた場合に限る）</div>
    <div class="clause clause-content">２　許諾者は、被許諾者に対し、前項の出版に関連する広告宣伝および販売促進を目的として本著作物の一部を利用した素材を制作、複製、頒布、展示することを非独占的に許諾する。</div>
    <div class="clause clause-content">３　被許諾者は、第１項に定める利用について、書店、取次、流通業者、配信プラットフォーム事業者その他被許諾者が適切と認める第三者に再許諾することができる。</div>
    <div class="clause clause-content">４　被許諾者は、採用する配信プラットフォームおよびデジタルフォーマットを個別契約において定めるものとし、以下の各号に該当する場合は速やかに許諾者に通知し、必要に応じて誠実に協議するものとする。</div>
    <div class="sub-clause">（1）　採用する配信プラットフォームまたはデジタルフォーマットを変更するとき</div>
    <div class="sub-clause">（2）　特定の配信プラットフォームへの独占的提供を条件とする配信プログラムに参加するとき</div>
    <div class="sub-clause">（3）　プラットフォームのサービス終了その他の事由により電子書籍配信の継続が困難となったとき</div>
    <div class="clause clause-content">５　被許諾者は、第１項第２号に基づく電子書籍の配信にあたり、DRMを適切に実装するものとする。ただし、許諾者の書面による承諾を得た場合はこの限りでない。被許諾者が第３項に基づく再許諾を配信プラットフォーム事業者に行う場合、当該プラットフォームが提供するDRM技術を本著作物の電子書籍データに適用する権限を、許諾者は被許諾者に予め授権するものとする。</div>
    <div class="clause clause-content">６　被許諾者は、使用するDRM技術の概要を個別契約において、または電子書籍の初回配信前に許諾者に通知するものとする。第三者によるDRM回避（著作権法第113条第7項が定める技術的保護手段の回避に該当する行為を含む）を知得した場合は、速やかに許諾者に通知するとともに合理的な措置を講じるものとする。</div>
    <div class="clause clause-content">７　本条に基づく許諾は、著作権法第79条以下に定める出版権の設定ではなく、当事者間の独占的利用許諾である。両当事者が協議の上、同法第79条第２項に定める出版権（電子書籍配信を含む）の設定を希望する場合は、別途書面により合意するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第４条　（二次利用の許諾および再許諾権）</div>
    <div class="clause clause-content">　許諾者は、被許諾者に対し、個別契約、追加条件書、覚書その他の書面（以下本条において「追加条件書等」という）において明示された範囲および条件に限り、本著作物について、以下の各号に定める権利を独占的に許諾する（以下「二次利用」という）。</div>
    <div class="sub-clause">（1）　翻訳・翻案その他の方法による二次的著作物の創作（著作権法第27条）</div>
    <div class="sub-clause">（2）　前号により創作された二次的著作物の複製・上演・演奏・上映・公衆送信・展示・頒布・譲渡・貸与その他の利用（著作権法第28条）</div>
    <div class="sub-clause">（3）　本著作物に含まれる図版・イラスト等を商品（グッズ・ポスター・アートプリント・クリアファイルその他）に用いた製造・販売（著作権法第21条）</div>
    <div class="sub-clause">（4）　本著作物を翻案して実写映画・アニメーション・テレビドラマ・OVAその他の映像作品を制作し、上映・放送・配信・頒布すること（著作権法第22条の2、第23条、第26条、第27条および第28条）</div>
    <div class="sub-clause">（5）　本著作物に含まれるキャラクターデザイン・背景・UI素材等をビデオゲームその他のゲームソフトウェアに利用し、または本著作物に基づくゲームのキャラクター・世界観を創作すること（著作権法第21条、第27条および第28条）</div>
    <div class="sub-clause">（6）　上記各号のほか、追加条件書等において別途定めた利用態様</div>
    <div class="clause clause-content">２　本基本契約は、前項各号の二次利用を将来の権利メニューとして定めるものであり、本基本契約の締結のみをもって、商品化、映像化、デジタルゲーム化、アプリ化、グッズ化その他通常の出版利用を超える利用が当然に許諾されるものではない。これらの利用は、追加条件書等において、対象著作物、利用態様、地域、期間、対価、監修・承認条件その他必要な条件が明示された場合に限り許諾される。</div>
    <div class="clause clause-content">３　許諾者は、被許諾者が、追加条件書等において許諾された二次利用に係る権利の全部または一部を、自らの判断により第三者に再許諾することを認める（著作権等管理事業の委託を意図するものではない）。被許諾者は、再許諾を行う場合、以下の条件を遵守するものとする。</div>
    <div class="sub-clause">（1）　再許諾先に対し、本著作物の著作権および著作者人格権が許諾者に帰属する旨を契約書において明示すること</div>
    <div class="sub-clause">（2）　再許諾先に対し、許諾者の著作権表示（クレジット表記）を維持する義務を課すること</div>
    <div class="sub-clause">（3）　再許諾の相手方・利用態様・条件の概要を、再許諾後30日以内に許諾者に書面（電磁的方法を含む）で報告すること</div>
    <div class="clause clause-content">４　第１項第４号（映像化）および第５号（デジタルゲーム化）に係る再許諾については、前項本文の規定にかかわらず、被許諾者は当該プロジェクトの企画・主要条件（制作会社、配信先、対象プラットフォーム、制作スケジュール、主要な収益条件の概要を含む）を事前に許諾者に書面で提示し、許諾者の書面による承諾を得るものとする。許諾者は提示受領後20営業日以内に回答するものとし、合理的な理由なく承諾を拒絶または留保しないものとする。ただし、回答がないことのみをもって承諾があったものとはみなさない。</div>
    <div class="clause clause-content">５　第３項の再許諾は、本基本契約および当該追加条件書等の有効期間中に限り効力を有する。本基本契約または当該追加条件書等が終了した場合、被許諾者は再許諾先に対し速やかに許諾終了を通知するものとする。ただし、再許諾先が終了時点までに適法に制作・流通させた成果物の取扱いについては、別途誠実に協議する。</div>
    <div class="clause clause-content">６　被許諾者は、本条に基づく再許諾によって生じる再許諾先の行為について、許諾者との関係において責任を負うものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第５条　（著作者人格権の不行使）</div>
    <div class="clause clause-content">　許諾者は、被許諾者および被許諾者が本基本契約に基づき再許諾した第三者に対し、本基本契約に基づく一切の利用において、著作者人格権（公表権、氏名表示権および同一性保持権）を行使しないものとする。</div>
    <div class="clause clause-content">２　前項にかかわらず、許諾者の名誉または声望を害する方法による利用（著作権法第113条第11項）に対しては、許諾者は著作者人格権を行使することができる。</div>
    <div class="clause clause-content">３　本条は、許諾者の著作者人格権を放棄するものではなく、本基本契約に基づく利用の範囲内における不行使の合意にとどまる。</div>
  </div>

  <div class="article">
    <div class="article-title">第６条　（AI学習利用の制限）</div>
    <div class="clause clause-content">　被許諾者は、本著作物（本著作物に含まれる図版・イラスト等を含む。以下本条において同じ）を、生成AI・機械学習モデルその他のAIシステムの学習用データセットとして利用し、または第三者に提供してはならない。</div>
    <div class="clause clause-content">２　前項にかかわらず、被許諾者が事前に許諾者の書面による承諾を得た場合は、この限りでない。この場合の条件（利用目的・利用態様・データの取扱い・対価を含む）については、別途書面で合意するものとする。</div>
    <div class="clause clause-content">３　被許諾者は、本基本契約に基づき再許諾した第三者に対しても、前２項と同等のAI学習利用制限を課す旨を再許諾契約に明記するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第７条　（第三者知的財産権の取扱い）</div>
    <div class="clause clause-content">　本条は、本著作物が第三者（以下「原権利者」という）の保有する著作権・商標権・その他の知的財産権に係る許諾（以下「原許諾」という）を前提として創作されている場合に適用する。本著作物が第三者の知的財産権に係る許諾を前提としない場合、本条は適用されない。</div>
    <div class="clause clause-content">２　許諾者は、被許諾者に対し、以下の事項を表明し、保証する。</div>
    <div class="sub-clause">（1）　個別契約締結時点において、原許諾を有効に取得し、かつ維持していること</div>
    <div class="sub-clause">（2）　原許諾の内容が、被許諾者による本基本契約に基づく利用（二次利用・再許諾を含む）を包含していること、またはそのための権限が許諾者に付与されていること</div>
    <div class="sub-clause">（3）　原許諾の有効期間が個別契約の有効期間をカバーしていること。カバーしていない場合は、その旨および原許諾の満了時期を個別契約締結前に被許諾者に対して書面で開示していること</div>
    <div class="clause clause-content">３　許諾者は、被許諾者に対し、原許諾の概要（原権利者名・許諾内容・有効期間・主要な制限事項）を個別契約の別紙「原許諾概要書」に記載して開示するものとする。開示内容に変更が生じた場合は、速やかに更新情報を書面で通知するものとする。</div>
    <div class="clause clause-content">４　原許諾が終了し、原権利者との間に紛争が生じ、または原許諾の内容が変更されて被許諾者の利用に影響を及ぼすおそれが生じた場合、許諾者は直ちに被許諾者に書面で通知するものとする。</div>
    <div class="clause clause-content">５　前項の通知を受けた場合、または原許諾の終了・紛争等により被許諾者による個別契約に基づく利用が制限されるおそれがあると合理的に認められる場合、被許諾者は当該個別契約を解除することができる。</div>
    <div class="clause clause-content">６　原許諾に起因して被許諾者が損害を被った場合、許諾者はその損害を賠償するものとする。ただし、許諾者が原権利者の責に帰すべき事由により原許諾の終了を招き、かつ許諾者に故意または重大な過失がない場合はこの限りでない。</div>
  </div>

  <div class="article">
    <div class="article-title">第８条　（原稿引渡し等）</div>
    <div class="clause clause-content">　許諾者は、個別契約に定める原稿引渡期日までに、本著作物の完全な原稿（以下「原稿」という）を、被許諾者に引渡すものとする。</div>
    <div class="clause clause-content">２　許諾者は、被許諾者の要請に応じて、本出版物の制作および発行に必要かつ合理的な範囲で協力するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第９条　（出版物等の制作）</div>
    <div class="clause clause-content">　被許諾者は、本出版物の制作にあたり、本著作物の内容または題号を変更しようとする場合には、事前に許諾者に通知し、その承諾を得るものとする。</div>
    <div class="clause clause-content">２　被許諾者が本出版物の制作のために作成したレイアウトデータ、組版データ、印刷用データ、装丁デザイン、その他の中間成果物（以下「制作用データ等」という）に関する著作権以外の一切の権利は、被許諾者に帰属する。</div>
    <div class="clause clause-content">３　許諾者は、被許諾者の事前の書面による承諾なく、制作用データ等を利用し、または第三者に利用させてはならない。本基本契約が終了した後においても同様とする。</div>
  </div>

  <div class="article">
    <div class="article-title">第１０条　（出版物の販売等）</div>
    <div class="clause clause-content">　被許諾者は、本出版物の販売価格、造本形態、配本方法その他の販売に関する事項を自らの裁量により決定することができる。ただし、著作物の価値または著作者の名誉・信用を著しく毀損する態様での販売は行わないものとする。</div>
    <div class="clause clause-content">２　被許諾者は、本著作物の内容が法令、公序良俗、または社会的通念に照らして販売等に適さないと合理的に判断した場合には、許諾者に対しその旨を通知し、対応について協議する。協議が整わない場合、被許諾者は当該個別契約を解除することができる。</div>
    <div class="clause clause-content">３　許諾者は、被許諾者が本出版物を、図書館、教育機関、書店、販売促進イベント等において、貸与、展示、見本誌として無償提供すること、ならびに広告宣伝目的で使用することを承諾する。</div>
  </div>

  <div class="article">
    <div class="article-title">第１１条　（出版継続・絶版・販売終了）</div>
    <div class="clause clause-content">　本基本契約において「絶版」または「販売終了」とは、個別契約に定める利用類型ごとに、以下の全ての状態が継続して12か月以上経過した場合をいう。ただし、個別契約において別段の定めをした場合は、その定めを優先する。</div>
    <div class="sub-clause">（1）　紙媒体出版については、被許諾者および正規取扱店において販売可能な在庫が実質的に消滅し、かつ被許諾者が重版またはオンデマンド印刷による販売継続を予定していないこと。</div>
    <div class="sub-clause">（2）　電子書籍出版については、主要な配信プラットフォームにおける配信が停止され、かつ被許諾者が再配信を予定していないこと。</div>
    <div class="sub-clause">（3）　海外出版・商品化・映像化・デジタルゲーム化その他の二次利用については、当該利用類型に係る再許諾契約または実施中の企画が終了し、かつ新たな利用予定が具体化していないこと。</div>
    <div class="clause clause-content">２　許諾者は、前項各号のいずれかに該当する可能性があると合理的に判断した場合、被許諾者に対し、当該利用類型について出版継続、配信継続、重版、再配信または二次利用継続の意思の有無を確認する書面を送付することができる。</div>
    <div class="clause clause-content">３　被許諾者は、前項の確認書面を受領した日から45日以内に、当該利用類型について継続意思の有無および予定される対応の概要を許諾者に通知するものとする。被許諾者が継続意思を通知した場合、通知日から６か月以内に重版、再配信、再許諾交渉その他の合理的な継続措置に着手するものとする。</div>
    <div class="clause clause-content">４　被許諾者が前項の期間内に継続意思を通知しない場合、または継続意思を通知したにもかかわらず合理的な継続措置に着手しない場合、許諾者は、当該利用類型に限り、個別契約上の許諾を終了させることができる。ただし、既に製造済みの在庫、配信中コンテンツ、再許諾先との既存契約および終了前に発生した権利義務の取扱いについては、個別契約または当事者間の協議に従うものとする。</div>
    <div class="clause clause-content">５　前項に基づき一部の利用類型が終了した場合であっても、その他の利用類型および本基本契約の効力には影響しない。</div>
  </div>

  <div class="article">
    <div class="article-title">第１２条　（改訂版・新版の取扱い）</div>
    <div class="clause clause-content">　本基本契約の対象著作物は、各個別契約に記載の著作物に限り、許諾者が新たに創作した改訂版・増補版・完全版・新装版その他の版（以下「改訂版等」という）は、原則として当該個別契約の対象に含まれない。</div>
    <div class="clause clause-content">２　ただし、改訂版等の内容が原著作物と実質的に同一である場合（全体に対する変更・追加の分量が概ね20%未満である場合を含む）は、当該個別契約の対象に含まれるものとみなす。</div>
    <div class="clause clause-content">３　許諾者が改訂版等を新たに発行しようとする場合、許諾者は被許諾者に対し、発行予定日の６か月前までに書面でその旨を通知し、被許諾者に優先交渉権を付与するものとする。被許諾者は通知受領後30日以内に交渉の意思を書面で回答するものとし、以後60日以内に条件合意に至らない場合、許諾者は第三者と交渉することができる。</div>
  </div>

  <div class="article">
    <div class="article-title">第１３条　（著作者による本著作物等の利用制限）</div>
    <div class="clause clause-content">　許諾者は、個別契約において競合利用制限の対象として定めた著作物、利用態様、期間および地域について、被許諾者の事前の書面による承諾なく、自らまたは第三者をして、本出版物等と実質的に競合する出版、配信、商品化その他の利用を行い、または第三者に許諾してはならない。</div>
    <div class="clause clause-content">２　前項の制限は、個別契約に明示された範囲に限り適用されるものとし、許諾者による自己紹介、ポートフォリオ掲載、既存実績の表示、個別のイラスト・文章の非競合的利用その他本出版物等の市場を実質的に害しない利用を当然に禁止するものではない。</div>
    <div class="clause clause-content">３　許諾者が、本著作物と関連する新規企画、改訂版、増補版、続編その他本出版物等と市場上関連し得る企画を第三者に許諾しようとする場合で、個別契約に優先交渉権の定めがあるときは、当該定めに従うものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第１４条　（貸与権および電子書籍デジタル貸出の許諾）</div>
    <div class="clause clause-content">　許諾者は、被許諾者に対し、紙媒体出版物の貸与に関する権利（著作権法第26条の3）を許諾する。</div>
    <div class="clause clause-content">２　許諾者は、被許諾者に対し、図書館等による電子書籍の利用者への提供（いわゆるデジタル貸出）その他電子書籍の一時的な利用に係る公衆送信（著作権法第23条）を許諾する（個別契約において電子書籍出版を許諾すると定めた場合に限る）。</div>
    <div class="clause clause-content">３　被許諾者は、前２項に定める権利の行使およびその管理に必要な手続きを、著作権等管理事業法に基づく登録管理団体その他の適切な第三者に委託し、当該利用に係る利用料を受領することができる。</div>
  </div>

  <div class="article">
    <div class="article-title">第１５条　（著作権利用料の支払い）</div>
    <div class="clause clause-content">　被許諾者は、許諾者に対し、本基本契約に基づく各利用に係る著作権利用料（以下「印税」という）を、個別契約に定める条件のもと、許諾者が指定する金融機関口座に振込送金により支払うものとする。送金手数料は被許諾者の負担とする。</div>
    <div class="clause clause-content">２　支払に際し、所得税法等に基づき源泉徴収が必要な場合には、被許諾者は当該税額を控除した上で支払うことができる。</div>
    <div class="clause clause-content">３　被許諾者は、印税の支払ごとに、利用形態別の報告書（算定根拠・数量・単価を含む）を許諾者に提出するものとする。</div>
    <div class="clause clause-content">４　許諾者は、被許諾者の計算に疑義がある場合、支払日から12か月以内に書面で異議を申し出ることができる。被許諾者は当該申し出を受けた場合、関連帳票類を合理的な範囲で開示するものとする。</div>
    <div class="clause clause-content">５　被許諾者は、許諾者が消費税法第57条の2に基づく適格請求書発行事業者として登録されている場合、許諾者が発行する適格請求書（インボイス）の交付を受け、消費税相当額を含む著作権利用料を支払うものとする。</div>
    <div class="clause clause-content">６　許諾者が適格請求書発行事業者でない場合における消費税相当額の取扱い（経過措置の適用可否を含む）については、別途書面により合意するものとする。許諾者の登録状況に変更が生じた場合（登録の取得・取消・変更等を含む）、許諾者は速やかに被許諾者に書面で通知するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第１６条　（表明および保証）</div>
    <div class="clause clause-content">　許諾者は、被許諾者に対し、以下の各号の事項について表明し、保証する。</div>
    <div class="sub-clause">（1）　許諾者は、本著作物について、単独の著作権者であるか、または共同著作権者その他の権利者から、本基本契約および個別契約を締結し、本著作物を本基本契約に基づき許諾するために必要な権限を適法に取得していること。</div>
    <div class="sub-clause">（2）　個別契約または別紙「原許諾概要書」に明示された第三者知的財産権を除き、被許諾者が本基本契約および個別契約に基づき本著作物を利用するために、第三者の追加許諾を要せず、また被許諾者が第三者に著作権使用料等の対価を直接支払う義務を負わないこと。</div>
    <div class="sub-clause">（3）　本著作物の内容および表現が、第三者の著作権、著作者人格権、肖像権、プライバシー権、名誉権、商標権その他の権利を侵害していないこと。</div>
    <div class="sub-clause">（4）　本著作物が法令または公序良俗に反する内容を含まず、かつ虚偽の表示その他社会的信用を損なうおそれのある内容を含まないこと。</div>
    <div class="sub-clause">（5）　本著作物が共同著作物、職務著作、外注成果物、第三者原作、二次的著作物その他複数の権利者が関与する著作物である場合、許諾者は、当該関係者の氏名・名称、権利関係、許諾範囲、制限事項その他被許諾者の利用判断に必要な事項を、個別契約または別紙において正確に開示していること。</div>
    <div class="clause clause-content">２　許諾者が前項の保証に反し、第三者との間に紛争が生じた場合は、自己の責任と費用負担において解決し、被許諾者に一切の損害を与えないものとする。万一被許諾者が損害を被った場合には、その損害を賠償するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第１７条　（譲渡禁止）</div>
    <div class="clause clause-content">　許諾者は、被許諾者の事前の書面による承諾なくして、本著作物に係る著作権（全部または一部）を第三者に譲渡し、または担保の目的に供してはならない。</div>
    <div class="clause clause-content">２　許諾者および被許諾者は、相手方の事前の書面による承諾なくして、本基本契約上の地位ならびに本基本契約に基づく権利義務（全部または一部）を第三者に譲渡し、または担保の目的に供してはならない。</div>
  </div>

  <div class="article">
    <div class="article-title">第１８条　（許諾者の死亡・権利承継）</div>
    <div class="clause clause-content">　許諾者が死亡した場合、本基本契約に基づく許諾者の権利義務は、相続人に承継されるものとする。</div>
    <div class="clause clause-content">２　許諾者の相続人（または遺言執行者。以下本条において「相続人等」という）は、許諾者の死亡を知った日から３か月以内に、被許諾者に対してその旨を書面で通知するものとする。</div>
    <div class="clause clause-content">３　通知がない場合においても、被許諾者は本基本契約に基づく義務を誠実に履行するものとし、判明した時点で速やかに相続人等と連絡を取るよう努めるものとする。</div>
    <div class="clause clause-content">４　相続人が複数存在する場合、相続人らは連名で、または代表者を定めて通知するものとし、権利義務の行使は原則として代表者を通じて行うものとする。</div>
    <div class="clause clause-content">５　著作者人格権は一身専属権であり（著作権法第59条）、相続の対象とならない。ただし、本基本契約に基づく著作者人格権の不行使の合意は、本著作物の利用態様に変更がない限り、相続人等に対しても効力を有するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第１９条　（秘密保持）</div>
    <div class="clause clause-content">　許諾者および被許諾者は、本基本契約の有効期間中および終了後３年間、本基本契約に関連して知り得た相手方の営業上、技術上その他一切の非公知の情報（以下「秘密情報」という）を、相手方の事前の書面による承諾なく、第三者に開示または漏洩してはならない。</div>
    <div class="clause clause-content">２　前項の規定にかかわらず、被許諾者は、本著作物に関する情報について、本出版物の制作、販売、広告宣伝、二次利用その他本基本契約に基づく利用を行うために必要な範囲で、秘密情報を自ら使用し、または第三者に提供することができる。</div>
    <div class="clause clause-content">３　次の各号に該当する情報については、前２項の義務の対象外とする。</div>
    <div class="sub-clause">（1）　開示を受けた時点で既に受領者が適法に保有していた情報</div>
    <div class="sub-clause">（2）　開示後、受領者が秘密保持義務を負うことなく適法に第三者から取得した情報</div>
    <div class="sub-clause">（3）　受領者が開示された情報に依拠することなく独自に開発または取得した情報</div>
    <div class="sub-clause">（4）　開示時または開示後に、受領者の責に帰さない事由により公知となった情報</div>
    <div class="sub-clause">（5）　法令または裁判所・行政機関等の命令により開示を求められた情報（事前通知・開示範囲限定に努めるものとする）</div>
  </div>

  <div class="article">
    <div class="article-title">第２０条　（個人情報の保護）</div>
    <div class="clause clause-content">　許諾者および被許諾者は、本基本契約の締結および履行に関連して取得した相手方または第三者の個人情報（個人情報の保護に関する法律第２条第１項に定めるものをいう。以下本条において同じ）を、同法その他の関係法令を遵守して適切に管理するものとする。</div>
    <div class="clause clause-content">２　許諾者および被許諾者は、前項の個人情報を本基本契約の履行に必要な範囲を超えて利用せず、また相手方の事前の書面による承諾なく第三者に提供または開示してはならない。ただし、法令または裁判所・行政機関の命令による場合はこの限りでない。</div>
    <div class="clause clause-content">３　被許諾者は、電子書籍の配信に際して配信プラットフォームを通じて取得した読者の購入履歴・閲覧データ等（個人を識別できるものに限る）を、本著作物の出版・流通の目的以外に利用してはならない。</div>
    <div class="clause clause-content">４　許諾者または被許諾者が個人情報の漏洩、滅失または毀損その他のセキュリティインシデントの発生を知得した場合、速やかに相手方に通知するとともに、個人情報の保護に関する法律第26条に基づく対応を含む必要な措置を講じるものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第２１条　（有効期間）</div>
    <div class="clause clause-content">　本基本契約の有効期間は、締結日から３年間とし、期間満了の３か月前までに書面による終了の申し入れがなされない場合、さらに３年間自動更新され、以後も同様とする。</div>
    <div class="clause clause-content">２　本基本契約の有効期間中に締結された個別契約は、本基本契約が終了した場合においても、当該個別契約の定める期間が満了するまで引き続き有効に存続するものとし、本基本契約の各条項は当該存続期間中引き続き適用されるものとする。</div>
    <div class="clause clause-content">３　本基本契約の終了後においても、被許諾者は、本出版物（電子書籍を含む）の既存在庫または配信中コンテンツが存在する限りにおいて、引き続き販売・配信を行うことができる。この場合、著作権利用料は個別契約に定める料率に従い支払うものとする。</div>
    <div class="clause clause-content">４　被許諾者は、契約終了後の販売・配信にあたっては、本基本契約の定めに従い誠実に取り扱うものとし、販売報告および著作権利用料の支払義務は、契約終了後も存続するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第２２条　（旧合意の取扱い）</div>
    <div class="clause clause-content">　許諾者と被許諾者との間で、本著作物またはその利用に関して本基本契約締結前に成立していた合意、覚書、発注書、電子メール、口頭合意、慣行その他の取決め（以下「旧合意」という）の取扱いは、個別契約において明示的に定める場合に限り、当該個別契約の定めに従うものとする。</div>
    <div class="clause clause-content">２　本基本契約の締結のみをもって、旧合意が当然に終了し、変更され、または本基本契約に包括統合されるものではない。旧合意を終了、変更、統合または確認する場合は、対象著作物、対象利用、対象期間、未払著作権利用料その他の清算事項を個別契約または別途書面に明記するものとする。</div>
    <div class="clause clause-content">３　旧合意に基づき既に発生し、または確定した権利義務（未払著作権利用料、報告義務、表明保証責任、秘密保持義務その他の債権債務を含む）は、個別契約に別段の定めがない限り、なお有効に存続する。</div>
    <div class="clause clause-content">４　本基本契約および個別契約と旧合意の内容が抵触する場合、当該抵触部分については、個別契約において優先関係を明示するものとし、明示がない場合は、当事者間で誠実に協議して解決する。</div>
  </div>

  <div class="article">
    <div class="article-title">第２３条　（不可抗力）</div>
    <div class="clause clause-content">　天災地変、戦争、テロ、暴動、火災、洪水、感染症の流行、大規模なサイバー攻撃、主要な電気通信設備の重大な障害、法令の制定・改廃、行政機関による命令その他不可抗力により、本基本契約の全部または一部の履行が困難または不可能となった場合、当該当事者は、その履行義務の全部または一部について責任を負わないものとする。</div>
    <div class="clause clause-content">２　前項に該当する事由が生じた場合、当該当事者は速やかに相手方に通知し、双方誠実に協議のうえ対応について合意するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第２４条　（著作権者等の表示）</div>
    <div class="clause clause-content">　被許諾者は、本出版物等（電子書籍・商品化物・映像化物・デジタルゲーム化物を含む）において、許諾者の権利を保全するため、個別契約に定める著作権表示に従い、適切な位置に以下の事項を表示するものとする。</div>
    <div class="sub-clause">（1）　著作権表示（©マーク）</div>
    <div class="sub-clause">（2）　著作権者名</div>
    <div class="sub-clause">（3）　発行年</div>
    <div class="sub-clause">（4）　その他、著作権保護のために必要と認められる表示</div>
  </div>

  <div class="article">
    <div class="article-title">第２５条　（著作権侵害に対する対応）</div>
    <div class="clause clause-content">　本著作物に関して、第三者による著作権侵害その他の権利侵害があった場合、許諾者および被許諾者は、当該侵害への対応について誠実に協議し、相互に協力して対処するものとする。</div>
    <div class="clause clause-content">２　前項の場合、必要に応じて、いずれか一方が自らの名義または共同名義で法的措置を講じることができるものとし、その際の費用および損害賠償の分担については、事前に協議のうえ定めるものとする。</div>
    <div class="clause clause-content">３　許諾者は、被許諾者が本著作物に係る第三者侵害に対応するために必要な範囲で、権利関係の説明、証拠資料の提供、警告書・削除申請・プラットフォーム申立て・税関差止申立てその他合理的な権利行使手続への協力を行うものとする。</div>
    <div class="clause clause-content">４　被許諾者は、海賊版、無断転載、無断配信その他本出版物等の販売・配信・二次利用に重大な支障を及ぼすおそれのある侵害を発見した場合、許諾者に事後報告したうえで、緊急性に応じて削除申請その他合理的な初動対応を行うことができる。</div>
  </div>

  <div class="article">
    <div class="article-title">第２６条　（著作者人格権の尊重）</div>
    <div class="clause clause-content">　被許諾者は、第５条に定める著作者人格権の不行使合意を前提としても、本著作物に関する著作者人格権の存在およびその趣旨を尊重し、本出版物等の制作および利用に際して、許諾者の名誉または声望を害する態様で本著作物を利用しないよう合理的に配慮する。</div>
    <div class="clause clause-content">２　許諾者は、本基本契約および個別契約に基づく本出版物等の制作、販売、配信、二次利用、広告宣伝その他の利用について、第５条に定める範囲で著作者人格権を行使しないものとする。ただし、被許諾者または再許諾先による利用が許諾者の名誉または声望を著しく害する場合は、この限りでない。</div>
  </div>

  <div class="article">
    <div class="article-title">第２７条　（契約の解除）</div>
    <div class="clause clause-content">　許諾者または被許諾者は、相手方が本基本契約に違反し、相当期間（原則として15営業日以上）を定めて書面により是正を求めたにもかかわらず是正されない場合、本基本契約（および当該違反に係る個別契約）を解除することができる。</div>
    <div class="clause clause-content">２　前項にかかわらず、次の各号のいずれかに該当した場合、相手方は何らの催告を要することなく、直ちに本基本契約（および全ての個別契約）を解除することができる。</div>
    <div class="sub-clause">（1）　破産、民事再生、会社更生、特別清算等の法的手続の申立てがなされた場合</div>
    <div class="sub-clause">（2）　差押え、仮差押え、仮処分、手形の不渡り、営業許可の取消し等、信用を著しく毀損する事由が生じた場合</div>
    <div class="sub-clause">（3）　反社会的勢力と認められる場合、またはその関係が判明した場合</div>
    <div class="sub-clause">（4）　その他本基本契約の継続が著しく困難であると合理的に認められる重大な事情がある場合</div>
  </div>

  <div class="article">
    <div class="article-title">第２８条　（反社会的勢力の排除）</div>
    <div class="clause clause-content">　許諾者および被許諾者（以下「当事者」という）は、それぞれ相手方に対し、次の各号の事項を確約する。</div>
    <div class="sub-clause">（1）　自らが暴力団、暴力団関係企業、総会屋若しくはこれらに準ずる者、またはその構成員（以下「反社会的勢力」という）ではないこと。</div>
    <div class="sub-clause">（2）　自らの役員（業務を執行する社員、取締役、執行役またはこれらに準ずる者）が反社会的勢力ではないこと。</div>
    <div class="sub-clause">（3）　反社会的勢力に自己の名義を利用させて本基本契約を締結したものではないこと。</div>
    <div class="sub-clause">（4）　本基本契約の有効期間中、自己または第三者を利用して、相手方に対して暴力的な要求、詐術的な行為、公序良俗に反する行為等を行わないこと。</div>
    <div class="clause clause-content">２　当事者の一方が前項の確約に違反したと判断された場合、相手方は何らの催告を要することなく、本基本契約を直ちに解除することができる。</div>
  </div>

  <div class="article">
    <div class="article-title">第２９条　（損害賠償責任）</div>
    <div class="clause clause-content">　当事者の一方が本基本契約または個別契約に違反し、または不法行為により相手方に損害を与えた場合、違反当事者は、相手方に生じた通常かつ直接の損害に限り、その賠償責任を負う。</div>
    <div class="clause clause-content">２　本条に基づく損害賠償額の上限は、当該損害に係る個別契約に基づき過去12か月間に被許諾者が許諾者に支払った著作権利用料の総額とする。ただし、第１６条（表明および保証）、第１９条（秘密保持）、第２０条（個人情報の保護）、第２８条（反社会的勢力の排除）に違反した場合、または故意若しくは重過失による場合は、この限りでない。</div>
    <div class="clause clause-content">３　本基本契約または個別契約の終了後であっても、終了前に発生した損害賠償請求権の行使を妨げない。</div>
  </div>

  <div class="article">
    <div class="article-title">第３０条　（準拠法・管轄裁判所）</div>
    <div class="clause clause-content">　本基本契約の成立、効力、履行および解釈については、日本国の法令を準拠法とする。</div>
    <div class="clause clause-content">２　本基本契約に関して紛争が生じた場合には、東京地方裁判所を第一審の専属的合意管轄裁判所とする。</div>
  </div>

  <div class="article">
    <div class="article-title">第３１条　（協議）</div>
    <div class="clause clause-content">　本基本契約に定めのない事項または疑義が生じた事項については、許諾者・被許諾者が誠実に協議して解決するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第３２条　（通知）</div>
    <div class="clause clause-content">　本基本契約に基づく通知その他の連絡は、当事者が事前に相手方に対して指定した通知先（頭書きに記載の担当者、電話番号および電子メールアドレスを含む。）に対して、書面、電子メールその他当事者間で合意した方法により行うものとする。</div>
    <div class="clause clause-content">２　各当事者は、自らの通知先を変更する場合、相手方に対してその旨を速やかに通知するものとし、当該通知が相手方に到達した時点以降、当該変更は有効となる。</div>
    <div class="clause clause-content">３　ただし、個別契約に本条と異なる定めがある場合は、当該個別契約の定めを優先する。</div>
  </div>

  <div class="margin-note">（以下余白）</div>

  <p class="preamble" style="margin-top:1.5em;">本基本契約の成立を証するため、本書の電磁的記録を作成し、許諾者と被許諾者が合意後、電子署名を施し、各自その電磁的記録を保管する。ただし、書面により締結する場合は本書２通を作成し、記名押印の上各１通を保有する。</p>

</div>
</body>
</html>$html_pub_master_individual$, $schema_pub_master_individual$[{"name": "契約番号", "label": "契約番号", "group": "I. ヘッダ", "dbField": "auto.docNumber", "helpText": "生成時に自動採番されます (ARC-PUB-YYYY-NNNN)"}, {"name": "契約締結日", "label": "契約締結日", "group": "I. ヘッダ", "required": true, "placeholder": "例: 2026年5月12日", "helpText": "PDF ヘッダ・署名欄に表示"}, {"name": "許諾者住所", "label": "許諾者 住所", "group": "II. 許諾者 (甲・個人)", "type": "textarea", "required": true, "dbField": "vendor.address"}, {"name": "許諾者氏名", "label": "許諾者 氏名", "group": "II. 許諾者 (甲・個人)", "required": true, "dbField": "vendor.vendor_name"}, {"name": "許諾者電話番号", "label": "許諾者 電話番号", "group": "II. 許諾者 (甲・個人)", "dbField": "vendor.phone"}, {"name": "許諾者メール", "label": "許諾者 メール", "group": "II. 許諾者 (甲・個人)", "dbField": "vendor.email"}, {"name": "アークライト住所", "label": "アークライト 住所", "group": "III. アークライト (乙)", "type": "textarea", "required": true, "helpText": "[自社] ボタンで自動入力", "dbField": "company.address"}, {"name": "アークライト代表者氏名", "label": "アークライト 代表者氏名", "group": "III. アークライト (乙)", "required": true, "dbField": "company.rep"}, {"name": "振込先銀行名", "label": "金融機関名", "group": "IV. 振込先口座 (許諾者)", "dbField": "vendor.bank_name"}, {"name": "支店名", "label": "支店名", "group": "IV. 振込先口座 (許諾者)", "dbField": "vendor.branch_name"}, {"name": "口座種別", "label": "口座種別", "group": "IV. 振込先口座 (許諾者)", "type": "select", "options": ["普通", "当座"], "dbField": "vendor.account_type"}, {"name": "口座番号", "label": "口座番号", "group": "IV. 振込先口座 (許諾者)", "dbField": "vendor.account_number"}, {"name": "口座名義カナ", "label": "口座名義 (カナ)", "group": "IV. 振込先口座 (許諾者)", "dbField": "vendor.account_holder_kana"}, {"name": "インボイス登録状況", "label": "適格請求書発行事業者", "group": "V. インボイス制度", "type": "select", "options": ["登録済", "未登録"], "placeholder": "登録済 / 未登録"}, {"name": "インボイス登録番号", "label": "登録番号 (T-)", "group": "V. インボイス制度", "dbField": "vendor.invoice_registration_number"}, {"name": "特記事項", "label": "特記事項", "group": "VI. 特記・発行オプション", "type": "textarea", "helpText": "未入力ならブランク表示"}, {"name": "再発行フラグ", "label": "再発行版バナーを表示", "group": "VI. 特記・発行オプション", "type": "boolean", "helpText": "ON で PDF 冒頭に「再発行版」バナーを表示"}, {"name": "改訂番号", "label": "改訂番号 (Rev.)", "group": "VI. 特記・発行オプション", "placeholder": "1", "helpText": "再発行版のとき表示"}, {"name": "元契約番号", "label": "元契約番号", "group": "VI. 特記・発行オプション", "placeholder": "ARC-PUB-2026-0001", "helpText": "再発行版のとき表示"}, {"name": "通知先担当者", "type": "text", "label": "通知先 担当者", "group": "VII. 通知先 (許諾者)", "helpText": "本契約上の通知の宛先(許諾者の担当者)"}, {"name": "通知先電話", "type": "text", "label": "通知先 電話", "group": "VII. 通知先 (許諾者)"}, {"name": "通知先メール", "type": "text", "label": "通知先 メール", "group": "VII. 通知先 (許諾者)"}]$schema_pub_master_individual$::jsonb, '通知先カテゴリ整備+個別契約優先の但し書き (0048)', 'migration-0048'
    FROM t RETURNING id, template_id)
UPDATE document_templates dt SET current_version_id=nv.id, updated_at=now() FROM nv WHERE dt.id=nv.template_id;

-- ===== pub_master_corporate =====
WITH t AS (SELECT id FROM document_templates WHERE template_key='pub_master_corporate'), nv AS (
  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  SELECT t.id, COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id=t.id),0)+1,
         $html_pub_master_corporate$<!DOCTYPE html>
<html lang="ja">
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>出版等許諾基本契約書（法人版） - {{契約番号}}</title>
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
    }
    .contract-document {
      max-width: 210mm;
      margin: 0 auto;
      background-color: #fff;
      padding: 18mm 20mm 22mm 25mm;
    }
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
    .doc-header .header-separator { color: #aaa; }
    .revision-notice {
      margin: 0.25em 0 0.9em;
      padding: 0.35em 0.75em;
      border: 0.8pt solid #b8a05a;
      color: #6f5600;
      background: #fffdf2;
      font-size: 8.8pt;
      font-weight: bold;
      text-align: center;
      letter-spacing: 0.03em;
    }
    h1.contract-title {
      text-align: center;
      font-size: 14pt;
      font-weight: bold;
      letter-spacing: 0.28em;
      margin-bottom: 0.3em;
      text-decoration: underline;
      text-underline-offset: 0.22em;
    }
    .contract-subtitle {
      text-align: center;
      font-size: 9pt;
      color: #444;
      margin-bottom: 1em;
      letter-spacing: 0.12em;
    }
    .tobogaki {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.15em;
      font-size: 9pt;
      line-height: 1.6;
      border-top: 1.5pt solid #1a1a1a;
      border-bottom: 1.5pt solid #1a1a1a;
    }
    .tobogaki th, .tobogaki td {
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
    }
    .tobogaki .col-item {
      width: 36%;
      font-weight: bold;
      color: #1a1a1a;
      padding-left: 0.5em;
    }
    .tobogaki .col-item .art-ref { font-size: 7.5pt; font-weight: normal; color: #777; }
    .tobogaki .col-item .sub-note {
      display: block;
      font-size: 7.5pt;
      font-weight: normal;
      color: #888;
      margin-top: 0.1em;
    }
    .tobogaki .col-value { width: 64%; word-break: break-all; overflow-wrap: break-word; color: #1a1a1a; }
    .tobogaki .special-cell { min-height: 2.5em; word-break: break-all; overflow-wrap: break-word; color: #1a1a1a; white-space: pre-wrap; }
    .head-signature { margin: 0.2em 0 1.3em; page-break-inside: avoid; font-size: 9.2pt; line-height: 1.55; }
    .head-signature .sig-date { text-align: right; margin-bottom: 0.8em; }
    .head-signature .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2em; }
    .head-signature .sig-party { border-top: 1pt solid #1a1a1a; padding-top: 0.5em; }
    .head-signature .party-label { font-weight: bold; margin-bottom: 0.3em; }
    .head-signature .sig-name-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8em; margin-top: 0.3em; }
    .head-signature .stamp-box { width: 52px; height: 52px; border: 1pt solid #1a1a1a; display: flex; justify-content: center; align-items: center; font-size: 11pt; background-color: #fff; flex-shrink: 0; }
    .preamble { font-size: 9.5pt; text-indent: 1em; margin-bottom: 0.9em; line-height: 1.7; text-align: justify; }
    .article { margin-bottom: 0.9em; page-break-inside: auto; }
    .article-title { font-weight: bold; font-size: 10pt; margin-bottom: 0.15em; page-break-after: avoid; }
    .clause { margin-left: 0; margin-bottom: 0.35em; text-align: justify; page-break-inside: auto; }
    .clause-content { padding-left: 1.5em; text-indent: -1.5em; }
    .sub-clause { margin-left: 1.5em; padding-left: 2em; text-indent: -2em; margin-bottom: 0.25em; text-align: justify; page-break-inside: auto; }
    .margin-note { text-align: center; margin: 1.5em 0 2em; font-size: 9pt; color: #666; }
    @media print {
      body { background-color: #fff; }
      .contract-document { box-shadow: none; margin: 0; width: 100%; max-width: none; padding: 0; }
      .head-signature, .tobogaki { page-break-inside: avoid; }
      p { orphans: 3; widows: 3; }
    }

  </style>
</head>
<body>
<div class="contract-document">

  <div class="doc-header">
    <span class="header-item">締結日：{{契約締結日}}</span>
    <span class="header-separator">｜</span>
    <span class="header-item">契約番号：{{契約番号}}</span>
  </div>

  {{#if 再発行フラグ}}
  <div class="revision-notice">再発行版 (Rev. {{改訂番号}}) — 元契約書: {{元契約番号}}</div>
  {{/if}}

  <h1 class="contract-title">出版等許諾基本契約書</h1>
  <div class="contract-subtitle">法人版（二次利用条項付き）</div>

  <table class="tobogaki">
    <tbody>

      <tr class="sec-row"><td colspan="2">当　事　者</td></tr>
      <tr>
        <td class="col-item">許諾者</td>
        <td class="col-value">
          {{許諾者住所}}<br>
          {{許諾者法人名}}<br>
          {{代表者職名}}　{{代表者氏名}}
        </td>
      </tr>
      <tr>
        <td class="col-item">被許諾者</td>
        <td class="col-value">
          {{アークライト住所}}<br>
          株式会社アークライト<br>
          代表取締役　{{アークライト代表者氏名}}
        </td>
      </tr>

      <tr class="sec-row"><td colspan="2">許　諾　条　件</td></tr>
      <tr>
        <td class="col-item">
          許諾範囲<span class="art-ref">（第３条・第４条・別紙）</span>
          <span class="sub-note">具体的条件・対象著作物・許諾地域は別紙個別契約による</span>
        </td>
        <td class="col-value">出版許諾：紙媒体・電子書籍（第３条）<br>二次利用許諾：翻訳・翻案等（第４条）<br>商品化・映像化・デジタルゲーム化等は、追加条件書、覚書その他の書面で明示した場合に限り許諾</td>
      </tr>
      <tr>
        <td class="col-item">
          著作権利用料（印税）<span class="art-ref">（第１５条・別紙）</span>
          <span class="sub-note">料率・算定根拠・支払期日は別紙個別契約による</span>
        </td>
        <td class="col-value">別紙個別契約に定めるとおり</td>
      </tr>
      <tr>
        <td class="col-item">
          振込先口座<span class="art-ref">（第１５条）</span>
          <span class="sub-note">許諾者が指定する金融機関口座</span>
        </td>
        <td class="col-value">
          {{振込先銀行名}}　{{支店名}}<br>
          {{口座種別}}　{{口座番号}}<br>
          口座名義（カナ）：{{口座名義カナ}}
        </td>
      </tr>
      <tr>
        <td class="col-item">
          インボイス制度<span class="art-ref">（第１５条第５項・第６項）</span>
          <span class="sub-note">適格請求書発行事業者の登録状況</span>
        </td>
        <td class="col-value">
          適格請求書発行事業者：{{インボイス登録状況}}<br>
          登録番号：{{インボイス登録番号}}
        </td>
      </tr>

      <!-- 通知先 -->
      <tr class="sec-row"><td colspan="2">通　知　先</td></tr>
      <tr>
        <td class="col-item">許諾者（甲）通知先<span class="art-ref">（第３２条）</span><br><span class="sub-note">本契約上の通知の宛先</span></td>
        <td class="col-value">
          担当者：{{通知先担当者}}<br>
          電話：{{通知先電話}}<br>
          メール：{{通知先メール}}
        </td>
      </tr>
      <tr>
        <td class="col-item">被許諾者（乙）通知先<span class="art-ref">（第３２条）</span><br><span class="sub-note">当社担当者（頭書きの担当者情報を引用）</span></td>
        <td class="col-value">
          担当者：{{STAFF_NAME}}<br>
          電話：{{STAFF_PHONE}}<br>
          メール：{{STAFF_EMAIL}}
        </td>
      </tr>
      <tr class="sec-row"><td colspan="2">準　拠　法・管　轄</td></tr>
      <tr>
        <td class="col-item">準拠法・合意管轄<span class="art-ref">（第３０条）</span></td>
        <td class="col-value">日本法／東京地方裁判所（第一審専属）</td>
      </tr>

      <tr class="sec-row"><td colspan="2">特　記　事　項</td></tr>
      <tr>
        <td colspan="2" class="special-cell">{{特記事項}}</td>
      </tr>
    </tbody>
  </table>


  <div class="head-signature">
    <div class="sig-date">{{契約締結日}}</div>
    <div class="sig-grid">
      <div class="sig-party">
        <div class="party-label">許諾者</div>
        <div>{{許諾者住所}}</div>
        <div>{{許諾者法人名}}</div>
        <div class="sig-name-row">
          <span>{{代表者職名}}　{{代表者氏名}}</span>
          <span class="stamp-box">印</span>
        </div>
        {{#if 担当者氏名}}<div style="font-size:8.5pt;margin-top:0.3em;">担当：{{担当者氏名}}{{#if 担当者電話番号}}　連絡先：{{担当者電話番号}}{{/if}}</div>{{/if}}
      </div>
      <div class="sig-party">
        <div class="party-label">被許諾者</div>
        <div>{{アークライト住所}}</div>
        <div>株式会社アークライト</div>
        <div class="sig-name-row">
          <span>代表取締役　{{アークライト代表者氏名}}</span>
          <span class="stamp-box">印</span>
        </div>
      </div>
    </div>
  </div>

  <p class="preamble">{{許諾者法人名}}（代表取締役{{代表者氏名}}）（以下「許諾者」という）と株式会社アークライト（以下「被許諾者」という）は、許諾者が著作権を保有する著作物の出版等に関する基本的な取引条件を定めるため、以下のとおり出版等許諾基本契約書（以下「本基本契約」という）を締結する。</p>


  <div class="article">
    <div class="article-title">第１条　（定義）</div>
    <div class="clause clause-content">　本基本契約において、以下の用語は以下の意味を有するものとする。</div>
    <div class="sub-clause">（1）　「個別契約」とは、本基本契約に基づき、被許諾者と許諾者との間で個別の著作物ごとに締結される利用許諾条件書をいう。</div>
    <div class="sub-clause">（2）　「本著作物」とは、各個別契約において特定された著作物をいう。</div>
    <div class="sub-clause">（3）　「本出版物」とは、本著作物に基づき被許諾者が制作・発行する出版物（電子書籍を含む）をいう。</div>
    <div class="sub-clause">（4）　「技術的保護手段（DRM）」とは、著作権法第２条第１項第20号に定める技術的保護手段をいい、電子書籍の不正複製・不正配布を防止するためにコンテンツデータに適用される電子的手段をいう。</div>
    <div class="sub-clause">（5）　「配信プラットフォーム」とは、電子書籍の配信・販売を行う事業者が運営するオンラインサービスおよびそのシステムをいう。</div>
    <div class="sub-clause">（6）　「電子書籍」とは、本著作物に基づき被許諾者が制作・配信するデジタルコンテンツであって、スマートフォン・タブレット端末・電子書籍専用端末・PCその他の汎用情報端末向けの電子書籍ストアまたは電子書籍専用アプリを通じて配信されるものをいう。家庭用ゲーム機・ゲームコンソール・ゲームプラットフォームその他のゲーム専用システムを通じた配信は、本定義における「電子書籍」に含まない。</div>
  </div>

  <div class="article">
    <div class="article-title">第２条　（個別契約との関係）</div>
    <div class="clause clause-content">　被許諾者と許諾者は、本基本契約に基づき、個別の著作物ごとに個別契約を締結するものとする。</div>
    <div class="clause clause-content">２　個別契約は本基本契約の一部を構成する。本基本契約と個別契約との間に矛盾または相違がある場合は、別段の定めがない限り、個別契約の定めが優先するものとする。</div>
    <div class="clause clause-content">３　本基本契約は、個別契約が締結された場合に、当該個別契約に係る著作物の利用について効力を生じる。</div>
  </div>

    <div class="article">
    <div class="article-title">第３条　（出版の許諾）</div>
    <div class="clause clause-content">　許諾者は、被許諾者に対し、個別契約に定める条件の下で、本著作物について以下の各号に定める権利を独占的に許諾する。</div>
    <div class="sub-clause">（1）　印刷媒体を用いた出版物（オンデマンド印刷を含む。以下「紙媒体出版物」という）として複製し、頒布すること（著作権法第21条・第26条の2）</div>
    <div class="sub-clause">（2）　電子書籍（第１条第６号に定めるものをいう）の複製・公衆送信（送信可能化を含む）（著作権法第21条・第23条）（個別契約において電子書籍出版を許諾すると定めた場合に限る）</div>
    <div class="clause clause-content">２　許諾者は、被許諾者に対し、前項の出版に関連する広告宣伝および販売促進を目的として本著作物の一部を利用した素材を制作、複製、頒布、展示することを非独占的に許諾する。</div>
    <div class="clause clause-content">３　被許諾者は、第１項に定める利用について、書店、取次、流通業者、配信プラットフォーム事業者その他被許諾者が適切と認める第三者に再許諾することができる。</div>
    <div class="clause clause-content">４　被許諾者は、採用する配信プラットフォームおよびデジタルフォーマットを個別契約において定めるものとし、以下の各号に該当する場合は速やかに許諾者に通知し、必要に応じて誠実に協議するものとする。</div>
    <div class="sub-clause">（1）　採用する配信プラットフォームまたはデジタルフォーマットを変更するとき</div>
    <div class="sub-clause">（2）　特定の配信プラットフォームへの独占的提供を条件とする配信プログラムに参加するとき</div>
    <div class="sub-clause">（3）　プラットフォームのサービス終了その他の事由により電子書籍配信の継続が困難となったとき</div>
    <div class="clause clause-content">５　被許諾者は、第１項第２号に基づく電子書籍の配信にあたり、DRMを適切に実装するものとする。ただし、許諾者の書面による承諾を得た場合はこの限りでない。被許諾者が第３項に基づく再許諾を配信プラットフォーム事業者に行う場合、当該プラットフォームが提供するDRM技術を本著作物の電子書籍データに適用する権限を、許諾者は被許諾者に予め授権するものとする。</div>
    <div class="clause clause-content">６　被許諾者は、使用するDRM技術の概要を個別契約において、または電子書籍の初回配信前に許諾者に通知するものとする。第三者によるDRM回避（著作権法第113条第7項が定める技術的保護手段の回避に該当する行為を含む）を知得した場合は、速やかに許諾者に通知するとともに合理的な措置を講じるものとする。</div>
    <div class="clause clause-content">７　本条に基づく許諾は、著作権法第79条以下に定める出版権の設定ではなく、当事者間の独占的利用許諾である。両当事者が協議の上、同法第79条第２項に定める出版権（電子書籍配信を含む）の設定を希望する場合は、別途書面により合意するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第４条　（二次利用の許諾および再許諾権）</div>
    <div class="clause clause-content">　許諾者は、被許諾者に対し、個別契約、追加条件書、覚書その他の書面（以下本条において「追加条件書等」という）において明示された範囲および条件に限り、本著作物について、以下の各号に定める権利を独占的に許諾する（以下「二次利用」という）。</div>
    <div class="sub-clause">（1）　翻訳・翻案その他の方法による二次的著作物の創作（著作権法第27条）</div>
    <div class="sub-clause">（2）　前号により創作された二次的著作物の複製・上演・演奏・上映・公衆送信・展示・頒布・譲渡・貸与その他の利用（著作権法第28条）</div>
    <div class="sub-clause">（3）　本著作物に含まれる図版・イラスト等を商品（グッズ・ポスター・アートプリント・クリアファイルその他）に用いた製造・販売（著作権法第21条）</div>
    <div class="sub-clause">（4）　本著作物を翻案して実写映画・アニメーション・テレビドラマ・OVAその他の映像作品を制作し、上映・放送・配信・頒布すること（著作権法第22条の2、第23条、第26条、第27条および第28条）</div>
    <div class="sub-clause">（5）　本著作物に含まれるキャラクターデザイン・背景・UI素材等をビデオゲームその他のゲームソフトウェアに利用し、または本著作物に基づくゲームのキャラクター・世界観を創作すること（著作権法第21条、第27条および第28条）</div>
    <div class="sub-clause">（6）　上記各号のほか、追加条件書等において別途定めた利用態様</div>
    <div class="clause clause-content">２　本基本契約は、前項各号の二次利用を将来の権利メニューとして定めるものであり、本基本契約の締結のみをもって、商品化、映像化、デジタルゲーム化、アプリ化、グッズ化その他通常の出版利用を超える利用が当然に許諾されるものではない。これらの利用は、追加条件書等において、対象著作物、利用態様、地域、期間、対価、監修・承認条件その他必要な条件が明示された場合に限り許諾される。</div>
    <div class="clause clause-content">３　許諾者は、被許諾者が、追加条件書等において許諾された二次利用に係る権利の全部または一部を、自らの判断により第三者に再許諾することを認める（著作権等管理事業の委託を意図するものではない）。被許諾者は、再許諾を行う場合、以下の条件を遵守するものとする。</div>
    <div class="sub-clause">（1）　再許諾先に対し、本著作物の著作権および著作者人格権が許諾者に帰属する旨を契約書において明示すること</div>
    <div class="sub-clause">（2）　再許諾先に対し、許諾者の著作権表示（クレジット表記）を維持する義務を課すること</div>
    <div class="sub-clause">（3）　再許諾の相手方・利用態様・条件の概要を、再許諾後30日以内に許諾者に書面（電磁的方法を含む）で報告すること</div>
    <div class="clause clause-content">４　第１項第４号（映像化）および第５号（デジタルゲーム化）に係る再許諾については、前項本文の規定にかかわらず、被許諾者は当該プロジェクトの企画・主要条件（制作会社、配信先、対象プラットフォーム、制作スケジュール、主要な収益条件の概要を含む）を事前に許諾者に書面で提示し、許諾者の書面による承諾を得るものとする。許諾者は提示受領後20営業日以内に回答するものとし、合理的な理由なく承諾を拒絶または留保しないものとする。ただし、回答がないことのみをもって承諾があったものとはみなさない。</div>
    <div class="clause clause-content">５　第３項の再許諾は、本基本契約および当該追加条件書等の有効期間中に限り効力を有する。本基本契約または当該追加条件書等が終了した場合、被許諾者は再許諾先に対し速やかに許諾終了を通知するものとする。ただし、再許諾先が終了時点までに適法に制作・流通させた成果物の取扱いについては、別途誠実に協議する。</div>
    <div class="clause clause-content">６　被許諾者は、本条に基づく再許諾によって生じる再許諾先の行為について、許諾者との関係において責任を負うものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第５条　（著作者人格権の不行使）</div>
    <div class="clause clause-content">　許諾者は、被許諾者および被許諾者が本基本契約に基づき再許諾した第三者に対し、本基本契約に基づく一切の利用において、著作者人格権（公表権、氏名表示権および同一性保持権）を行使しないものとする。</div>
    <div class="clause clause-content">２　前項にかかわらず、許諾者の名誉または声望を害する方法による利用（著作権法第113条第11項）に対しては、許諾者は著作者人格権を行使することができる。</div>
    <div class="clause clause-content">３　本条は、許諾者の著作者人格権を放棄するものではなく、本基本契約に基づく利用の範囲内における不行使の合意にとどまる。</div>
  </div>

  <div class="article">
    <div class="article-title">第６条　（AI学習利用の制限）</div>
    <div class="clause clause-content">　被許諾者は、本著作物（本著作物に含まれる図版・イラスト等を含む。以下本条において同じ）を、生成AI・機械学習モデルその他のAIシステムの学習用データセットとして利用し、または第三者に提供してはならない。</div>
    <div class="clause clause-content">２　前項にかかわらず、被許諾者が事前に許諾者の書面による承諾を得た場合は、この限りでない。この場合の条件（利用目的・利用態様・データの取扱い・対価を含む）については、別途書面で合意するものとする。</div>
    <div class="clause clause-content">３　被許諾者は、本基本契約に基づき再許諾した第三者に対しても、前２項と同等のAI学習利用制限を課す旨を再許諾契約に明記するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第７条　（第三者知的財産権の取扱い）</div>
    <div class="clause clause-content">　本条は、本著作物が第三者（以下「原権利者」という）の保有する著作権・商標権・その他の知的財産権に係る許諾（以下「原許諾」という）を前提として創作されている場合に適用する。本著作物が第三者の知的財産権に係る許諾を前提としない場合、本条は適用されない。</div>
    <div class="clause clause-content">２　許諾者は、被許諾者に対し、以下の事項を表明し、保証する。</div>
    <div class="sub-clause">（1）　個別契約締結時点において、原許諾を有効に取得し、かつ維持していること</div>
    <div class="sub-clause">（2）　原許諾の内容が、被許諾者による本基本契約に基づく利用（二次利用・再許諾を含む）を包含していること、またはそのための権限が許諾者に付与されていること</div>
    <div class="sub-clause">（3）　原許諾の有効期間が個別契約の有効期間をカバーしていること。カバーしていない場合は、その旨および原許諾の満了時期を個別契約締結前に被許諾者に対して書面で開示していること</div>
    <div class="clause clause-content">３　許諾者は、被許諾者に対し、原許諾の概要（原権利者名・許諾内容・有効期間・主要な制限事項）を個別契約の別紙「原許諾概要書」に記載して開示するものとする。開示内容に変更が生じた場合は、速やかに更新情報を書面で通知するものとする。</div>
    <div class="clause clause-content">４　原許諾が終了し、原権利者との間に紛争が生じ、または原許諾の内容が変更されて被許諾者の利用に影響を及ぼすおそれが生じた場合、許諾者は直ちに被許諾者に書面で通知するものとする。</div>
    <div class="clause clause-content">５　前項の通知を受けた場合、または原許諾の終了・紛争等により被許諾者による個別契約に基づく利用が制限されるおそれがあると合理的に認められる場合、被許諾者は当該個別契約を解除することができる。</div>
    <div class="clause clause-content">６　原許諾に起因して被許諾者が損害を被った場合、許諾者はその損害を賠償するものとする。ただし、許諾者が原権利者の責に帰すべき事由により原許諾の終了を招き、かつ許諾者に故意または重大な過失がない場合はこの限りでない。</div>
  </div>

  <div class="article">
    <div class="article-title">第８条　（原稿引渡し等）</div>
    <div class="clause clause-content">　許諾者は、個別契約に定める原稿引渡期日までに、本著作物の完全な原稿（以下「原稿」という）を、被許諾者に引渡すものとする。</div>
    <div class="clause clause-content">２　許諾者は、被許諾者の要請に応じて、本出版物の制作および発行に必要かつ合理的な範囲で協力するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第９条　（出版物等の制作）</div>
    <div class="clause clause-content">　被許諾者は、本出版物の制作にあたり、本著作物の内容または題号を変更しようとする場合には、事前に許諾者に通知し、その承諾を得るものとする。</div>
    <div class="clause clause-content">２　被許諾者が本出版物の制作のために作成したレイアウトデータ、組版データ、印刷用データ、装丁デザイン、その他の中間成果物（以下「制作用データ等」という）に関する著作権以外の一切の権利は、被許諾者に帰属する。</div>
    <div class="clause clause-content">３　許諾者は、被許諾者の事前の書面による承諾なく、制作用データ等を利用し、または第三者に利用させてはならない。本基本契約が終了した後においても同様とする。</div>
  </div>

  <div class="article">
    <div class="article-title">第１０条　（出版物の販売等）</div>
    <div class="clause clause-content">　被許諾者は、本出版物の販売価格、造本形態、配本方法その他の販売に関する事項を自らの裁量により決定することができる。ただし、著作物の価値または著作者の名誉・信用を著しく毀損する態様での販売は行わないものとする。</div>
    <div class="clause clause-content">２　被許諾者は、本著作物の内容が法令、公序良俗、または社会的通念に照らして販売等に適さないと合理的に判断した場合には、許諾者に対しその旨を通知し、対応について協議する。協議が整わない場合、被許諾者は当該個別契約を解除することができる。</div>
    <div class="clause clause-content">３　許諾者は、被許諾者が本出版物を、図書館、教育機関、書店、販売促進イベント等において、貸与、展示、見本誌として無償提供すること、ならびに広告宣伝目的で使用することを承諾する。</div>
  </div>

  <div class="article">
    <div class="article-title">第１１条　（出版継続・絶版・販売終了）</div>
    <div class="clause clause-content">　本基本契約において「絶版」または「販売終了」とは、個別契約に定める利用類型ごとに、以下の全ての状態が継続して12か月以上経過した場合をいう。ただし、個別契約において別段の定めをした場合は、その定めを優先する。</div>
    <div class="sub-clause">（1）　紙媒体出版については、被許諾者および正規取扱店において販売可能な在庫が実質的に消滅し、かつ被許諾者が重版またはオンデマンド印刷による販売継続を予定していないこと。</div>
    <div class="sub-clause">（2）　電子書籍出版については、主要な配信プラットフォームにおける配信が停止され、かつ被許諾者が再配信を予定していないこと。</div>
    <div class="sub-clause">（3）　海外出版・商品化・映像化・デジタルゲーム化その他の二次利用については、当該利用類型に係る再許諾契約または実施中の企画が終了し、かつ新たな利用予定が具体化していないこと。</div>
    <div class="clause clause-content">２　許諾者は、前項各号のいずれかに該当する可能性があると合理的に判断した場合、被許諾者に対し、当該利用類型について出版継続、配信継続、重版、再配信または二次利用継続の意思の有無を確認する書面を送付することができる。</div>
    <div class="clause clause-content">３　被許諾者は、前項の確認書面を受領した日から45日以内に、当該利用類型について継続意思の有無および予定される対応の概要を許諾者に通知するものとする。被許諾者が継続意思を通知した場合、通知日から６か月以内に重版、再配信、再許諾交渉その他の合理的な継続措置に着手するものとする。</div>
    <div class="clause clause-content">４　被許諾者が前項の期間内に継続意思を通知しない場合、または継続意思を通知したにもかかわらず合理的な継続措置に着手しない場合、許諾者は、当該利用類型に限り、個別契約上の許諾を終了させることができる。ただし、既に製造済みの在庫、配信中コンテンツ、再許諾先との既存契約および終了前に発生した権利義務の取扱いについては、個別契約または当事者間の協議に従うものとする。</div>
    <div class="clause clause-content">５　前項に基づき一部の利用類型が終了した場合であっても、その他の利用類型および本基本契約の効力には影響しない。</div>
  </div>

  <div class="article">
    <div class="article-title">第１２条　（改訂版・新版の取扱い）</div>
    <div class="clause clause-content">　本基本契約の対象著作物は、各個別契約に記載の著作物に限り、許諾者が新たに創作した改訂版・増補版・完全版・新装版その他の版（以下「改訂版等」という）は、原則として当該個別契約の対象に含まれない。</div>
    <div class="clause clause-content">２　ただし、改訂版等の内容が原著作物と実質的に同一である場合（全体に対する変更・追加の分量が概ね20%未満である場合を含む）は、当該個別契約の対象に含まれるものとみなす。</div>
    <div class="clause clause-content">３　許諾者が改訂版等を新たに発行しようとする場合、許諾者は被許諾者に対し、発行予定日の６か月前までに書面でその旨を通知し、被許諾者に優先交渉権を付与するものとする。被許諾者は通知受領後30日以内に交渉の意思を書面で回答するものとし、以後60日以内に条件合意に至らない場合、許諾者は第三者と交渉することができる。</div>
  </div>

  <div class="article">
    <div class="article-title">第１３条　（著作者による本著作物等の利用制限）</div>
    <div class="clause clause-content">　許諾者は、個別契約において競合利用制限の対象として定めた著作物、利用態様、期間および地域について、被許諾者の事前の書面による承諾なく、自らまたは第三者をして、本出版物等と実質的に競合する出版、配信、商品化その他の利用を行い、または第三者に許諾してはならない。</div>
    <div class="clause clause-content">２　前項の制限は、個別契約に明示された範囲に限り適用されるものとし、許諾者による自己紹介、ポートフォリオ掲載、既存実績の表示、個別のイラスト・文章の非競合的利用その他本出版物等の市場を実質的に害しない利用を当然に禁止するものではない。</div>
    <div class="clause clause-content">３　許諾者が、本著作物と関連する新規企画、改訂版、増補版、続編その他本出版物等と市場上関連し得る企画を第三者に許諾しようとする場合で、個別契約に優先交渉権の定めがあるときは、当該定めに従うものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第１４条　（貸与権および電子書籍デジタル貸出の許諾）</div>
    <div class="clause clause-content">　許諾者は、被許諾者に対し、紙媒体出版物の貸与に関する権利（著作権法第26条の3）を許諾する。</div>
    <div class="clause clause-content">２　許諾者は、被許諾者に対し、図書館等による電子書籍の利用者への提供（いわゆるデジタル貸出）その他電子書籍の一時的な利用に係る公衆送信（著作権法第23条）を許諾する（個別契約において電子書籍出版を許諾すると定めた場合に限る）。</div>
    <div class="clause clause-content">３　被許諾者は、前２項に定める権利の行使およびその管理に必要な手続きを、著作権等管理事業法に基づく登録管理団体その他の適切な第三者に委託し、当該利用に係る利用料を受領することができる。</div>
  </div>

  <div class="article">
    <div class="article-title">第１５条　（著作権利用料の支払い）</div>
    <div class="clause clause-content">　被許諾者は、許諾者に対し、本基本契約に基づく各利用に係る著作権利用料（以下「印税」という）を、個別契約に定める条件のもと、許諾者が指定する金融機関口座に振込送金により支払うものとする。送金手数料は被許諾者の負担とする。</div>
    <div class="clause clause-content">２　支払に際し、所得税法等に基づき源泉徴収が必要な場合には、被許諾者は当該税額を控除した上で支払うことができる。</div>
    <div class="clause clause-content">３　被許諾者は、印税の支払ごとに、利用形態別の報告書（算定根拠・数量・単価を含む）を許諾者に提出するものとする。</div>
    <div class="clause clause-content">４　許諾者は、被許諾者の計算に疑義がある場合、支払日から12か月以内に書面で異議を申し出ることができる。被許諾者は当該申し出を受けた場合、関連帳票類を合理的な範囲で開示するものとする。</div>
    <div class="clause clause-content">５　被許諾者は、許諾者が消費税法第57条の2に基づく適格請求書発行事業者として登録されている場合、許諾者が発行する適格請求書（インボイス）の交付を受け、消費税相当額を含む著作権利用料を支払うものとする。</div>
    <div class="clause clause-content">６　許諾者が適格請求書発行事業者でない場合における消費税相当額の取扱い（経過措置の適用可否を含む）については、別途書面により合意するものとする。許諾者の登録状況に変更が生じた場合（登録の取得・取消・変更等を含む）、許諾者は速やかに被許諾者に書面で通知するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第１６条　（表明および保証）</div>
    <div class="clause clause-content">　許諾者は、被許諾者に対し、以下の各号の事項について表明し、保証する。</div>
    <div class="sub-clause">（1）　許諾者は、本著作物について、単独の著作権者であるか、または共同著作権者その他の権利者から、本基本契約および個別契約を締結し、本著作物を本基本契約に基づき許諾するために必要な権限を適法に取得していること。</div>
    <div class="sub-clause">（2）　個別契約または別紙「原許諾概要書」に明示された第三者知的財産権を除き、被許諾者が本基本契約および個別契約に基づき本著作物を利用するために、第三者の追加許諾を要せず、また被許諾者が第三者に著作権使用料等の対価を直接支払う義務を負わないこと。</div>
    <div class="sub-clause">（3）　本著作物の内容および表現が、第三者の著作権、著作者人格権、肖像権、プライバシー権、名誉権、商標権その他の権利を侵害していないこと。</div>
    <div class="sub-clause">（4）　本著作物が法令または公序良俗に反する内容を含まず、かつ虚偽の表示その他社会的信用を損なうおそれのある内容を含まないこと。</div>
    <div class="sub-clause">（5）　本著作物が共同著作物、職務著作、外注成果物、第三者原作、二次的著作物その他複数の権利者が関与する著作物である場合、許諾者は、当該関係者の氏名・名称、権利関係、許諾範囲、制限事項その他被許諾者の利用判断に必要な事項を、個別契約または別紙において正確に開示していること。</div>
    <div class="clause clause-content">２　許諾者が前項の保証に反し、第三者との間に紛争が生じた場合は、自己の責任と費用負担において解決し、被許諾者に一切の損害を与えないものとする。万一被許諾者が損害を被った場合には、その損害を賠償するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第１７条　（譲渡禁止）</div>
    <div class="clause clause-content">　許諾者は、被許諾者の事前の書面による承諾なくして、本著作物に係る著作権（全部または一部）を第三者に譲渡し、または担保の目的に供してはならない。</div>
    <div class="clause clause-content">２　許諾者および被許諾者は、相手方の事前の書面による承諾なくして、本基本契約上の地位ならびに本基本契約に基づく権利義務（全部または一部）を第三者に譲渡し、または担保の目的に供してはならない。</div>
  </div>

  <div class="article">
    <div class="article-title">第１８条　（許諾者の組織変更等）</div>
    <div class="clause clause-content">　許諾者が合併（吸収合併・新設合併）を行う場合、本基本契約に基づく許諾者の権利義務は、合併後の存続会社または新設会社に承継されるものとする。許諾者は、合併の効力発生日の１か月前までに、被許諾者に対して相手方会社名・合併の種別・効力発生予定日を書面で通知するものとする。</div>
    <div class="clause clause-content">２　許諾者が会社分割（吸収分割・新設分割）を行う場合、本基本契約に基づく権利義務が承継される分割後の会社の名称・所在地・代表者を、分割の効力発生日の１か月前までに書面で通知するものとする。承継先が本基本契約の履行について懸念があると被許諾者が合理的に判断した場合、被許諾者は本基本契約を解除することができる。</div>
    <div class="clause clause-content">３　許諾者が解散した場合、本基本契約は終了するものとする。ただし、清算手続中に既に発行済みの本出版物の販売・配信に係る権利義務は清算結了まで存続するものとし、清算人はその旨を被許諾者に通知するものとする。</div>
    <div class="clause clause-content">４　許諾者の代表者が変更された場合、許諾者は変更後14日以内に被許諾者に対して書面で通知するものとする。</div>
    <div class="clause clause-content">５　前各項の場合において、権利義務を承継する者が本基本契約の履行について懸念があると被許諾者が合理的に判断した場合、被許諾者は本基本契約を解除することができる。</div>
    <div class="clause clause-content">６　本著作物の著作権者が変更となった場合（共同著作者の離脱を含む）、許諾者は直ちに被許諾者に書面で通知するものとする。変更後の著作権者との間で本基本契約の継続についての合意が得られない場合、被許諾者は本基本契約を解除することができる。</div>
  </div>

  <div class="article">
    <div class="article-title">第１９条　（秘密保持）</div>
    <div class="clause clause-content">　許諾者および被許諾者は、本基本契約の有効期間中および終了後３年間、本基本契約に関連して知り得た相手方の営業上、技術上その他一切の非公知の情報（以下「秘密情報」という）を、相手方の事前の書面による承諾なく、第三者に開示または漏洩してはならない。</div>
    <div class="clause clause-content">２　前項の規定にかかわらず、被許諾者は、本著作物に関する情報について、本出版物の制作、販売、広告宣伝、二次利用その他本基本契約に基づく利用を行うために必要な範囲で、秘密情報を自ら使用し、または第三者に提供することができる。</div>
    <div class="clause clause-content">３　次の各号に該当する情報については、前２項の義務の対象外とする。</div>
    <div class="sub-clause">（1）　開示を受けた時点で既に受領者が適法に保有していた情報</div>
    <div class="sub-clause">（2）　開示後、受領者が秘密保持義務を負うことなく適法に第三者から取得した情報</div>
    <div class="sub-clause">（3）　受領者が開示された情報に依拠することなく独自に開発または取得した情報</div>
    <div class="sub-clause">（4）　開示時または開示後に、受領者の責に帰さない事由により公知となった情報</div>
    <div class="sub-clause">（5）　法令または裁判所・行政機関等の命令により開示を求められた情報（事前通知・開示範囲限定に努めるものとする）</div>
  </div>

  <div class="article">
    <div class="article-title">第２０条　（個人情報の保護）</div>
    <div class="clause clause-content">　許諾者および被許諾者は、本基本契約の締結および履行に関連して取得した相手方または第三者の個人情報（個人情報の保護に関する法律第２条第１項に定めるものをいう。以下本条において同じ）を、同法その他の関係法令を遵守して適切に管理するものとする。</div>
    <div class="clause clause-content">２　許諾者および被許諾者は、前項の個人情報を本基本契約の履行に必要な範囲を超えて利用せず、また相手方の事前の書面による承諾なく第三者に提供または開示してはならない。ただし、法令または裁判所・行政機関の命令による場合はこの限りでない。</div>
    <div class="clause clause-content">３　被許諾者は、電子書籍の配信に際して配信プラットフォームを通じて取得した読者の購入履歴・閲覧データ等（個人を識別できるものに限る）を、本著作物の出版・流通の目的以外に利用してはならない。</div>
    <div class="clause clause-content">４　許諾者または被許諾者が個人情報の漏洩、滅失または毀損その他のセキュリティインシデントの発生を知得した場合、速やかに相手方に通知するとともに、個人情報の保護に関する法律第26条に基づく対応を含む必要な措置を講じるものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第２１条　（有効期間）</div>
    <div class="clause clause-content">　本基本契約の有効期間は、締結日から３年間とし、期間満了の３か月前までに書面による終了の申し入れがなされない場合、さらに３年間自動更新され、以後も同様とする。</div>
    <div class="clause clause-content">２　本基本契約の有効期間中に締結された個別契約は、本基本契約が終了した場合においても、当該個別契約の定める期間が満了するまで引き続き有効に存続するものとし、本基本契約の各条項は当該存続期間中引き続き適用されるものとする。</div>
    <div class="clause clause-content">３　本基本契約の終了後においても、被許諾者は、本出版物（電子書籍を含む）の既存在庫または配信中コンテンツが存在する限りにおいて、引き続き販売・配信を行うことができる。この場合、著作権利用料は個別契約に定める料率に従い支払うものとする。</div>
    <div class="clause clause-content">４　被許諾者は、契約終了後の販売・配信にあたっては、本基本契約の定めに従い誠実に取り扱うものとし、販売報告および著作権利用料の支払義務は、契約終了後も存続するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第２２条　（旧合意の取扱い）</div>
    <div class="clause clause-content">　許諾者と被許諾者との間で、本著作物またはその利用に関して本基本契約締結前に成立していた合意、覚書、発注書、電子メール、口頭合意、慣行その他の取決め（以下「旧合意」という）の取扱いは、個別契約において明示的に定める場合に限り、当該個別契約の定めに従うものとする。</div>
    <div class="clause clause-content">２　本基本契約の締結のみをもって、旧合意が当然に終了し、変更され、または本基本契約に包括統合されるものではない。旧合意を終了、変更、統合または確認する場合は、対象著作物、対象利用、対象期間、未払著作権利用料その他の清算事項を個別契約または別途書面に明記するものとする。</div>
    <div class="clause clause-content">３　旧合意に基づき既に発生し、または確定した権利義務（未払著作権利用料、報告義務、表明保証責任、秘密保持義務その他の債権債務を含む）は、個別契約に別段の定めがない限り、なお有効に存続する。</div>
    <div class="clause clause-content">４　本基本契約および個別契約と旧合意の内容が抵触する場合、当該抵触部分については、個別契約において優先関係を明示するものとし、明示がない場合は、当事者間で誠実に協議して解決する。</div>
  </div>

  <div class="article">
    <div class="article-title">第２３条　（不可抗力）</div>
    <div class="clause clause-content">　天災地変、戦争、テロ、暴動、火災、洪水、感染症の流行、大規模なサイバー攻撃、主要な電気通信設備の重大な障害、法令の制定・改廃、行政機関による命令その他不可抗力により、本基本契約の全部または一部の履行が困難または不可能となった場合、当該当事者は、その履行義務の全部または一部について責任を負わないものとする。</div>
    <div class="clause clause-content">２　前項に該当する事由が生じた場合、当該当事者は速やかに相手方に通知し、双方誠実に協議のうえ対応について合意するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第２４条　（著作権者等の表示）</div>
    <div class="clause clause-content">　被許諾者は、本出版物等（電子書籍・商品化物・映像化物・デジタルゲーム化物を含む）において、許諾者の権利を保全するため、個別契約に定める著作権表示に従い、適切な位置に以下の事項を表示するものとする。</div>
    <div class="sub-clause">（1）　著作権表示（©マーク）</div>
    <div class="sub-clause">（2）　著作権者名</div>
    <div class="sub-clause">（3）　発行年</div>
    <div class="sub-clause">（4）　その他、著作権保護のために必要と認められる表示</div>
  </div>

  <div class="article">
    <div class="article-title">第２５条　（著作権侵害に対する対応）</div>
    <div class="clause clause-content">　本著作物に関して、第三者による著作権侵害その他の権利侵害があった場合、許諾者および被許諾者は、当該侵害への対応について誠実に協議し、相互に協力して対処するものとする。</div>
    <div class="clause clause-content">２　前項の場合、必要に応じて、いずれか一方が自らの名義または共同名義で法的措置を講じることができるものとし、その際の費用および損害賠償の分担については、事前に協議のうえ定めるものとする。</div>
    <div class="clause clause-content">３　許諾者は、被許諾者が本著作物に係る第三者侵害に対応するために必要な範囲で、権利関係の説明、証拠資料の提供、警告書・削除申請・プラットフォーム申立て・税関差止申立てその他合理的な権利行使手続への協力を行うものとする。</div>
    <div class="clause clause-content">４　被許諾者は、海賊版、無断転載、無断配信その他本出版物等の販売・配信・二次利用に重大な支障を及ぼすおそれのある侵害を発見した場合、許諾者に事後報告したうえで、緊急性に応じて削除申請その他合理的な初動対応を行うことができる。</div>
  </div>

  <div class="article">
    <div class="article-title">第２６条　（著作者人格権の尊重）</div>
    <div class="clause clause-content">　被許諾者は、第５条に定める著作者人格権の不行使合意を前提としても、本著作物に関する著作者人格権の存在およびその趣旨を尊重し、本出版物等の制作および利用に際して、許諾者の名誉または声望を害する態様で本著作物を利用しないよう合理的に配慮する。</div>
    <div class="clause clause-content">２　許諾者は、本基本契約および個別契約に基づく本出版物等の制作、販売、配信、二次利用、広告宣伝その他の利用について、第５条に定める範囲で著作者人格権を行使しないものとする。ただし、被許諾者または再許諾先による利用が許諾者の名誉または声望を著しく害する場合は、この限りでない。</div>
  </div>

  <div class="article">
    <div class="article-title">第２７条　（契約の解除）</div>
    <div class="clause clause-content">　許諾者または被許諾者は、相手方が本基本契約に違反し、相当期間（原則として15営業日以上）を定めて書面により是正を求めたにもかかわらず是正されない場合、本基本契約（および当該違反に係る個別契約）を解除することができる。</div>
    <div class="clause clause-content">２　前項にかかわらず、次の各号のいずれかに該当した場合、相手方は何らの催告を要することなく、直ちに本基本契約（および全ての個別契約）を解除することができる。</div>
    <div class="sub-clause">（1）　破産、民事再生、会社更生、特別清算等の法的手続の申立てがなされた場合</div>
    <div class="sub-clause">（2）　差押え、仮差押え、仮処分、手形の不渡り、営業許可の取消し等、信用を著しく毀損する事由が生じた場合</div>
    <div class="sub-clause">（3）　反社会的勢力と認められる場合、またはその関係が判明した場合</div>
    <div class="sub-clause">（4）　その他本基本契約の継続が著しく困難であると合理的に認められる重大な事情がある場合</div>
  </div>

  <div class="article">
    <div class="article-title">第２８条　（反社会的勢力の排除）</div>
    <div class="clause clause-content">　許諾者および被許諾者（以下「当事者」という）は、それぞれ相手方に対し、次の各号の事項を確約する。</div>
    <div class="sub-clause">（1）　自らが暴力団、暴力団関係企業、総会屋若しくはこれらに準ずる者、またはその構成員（以下「反社会的勢力」という）ではないこと。</div>
    <div class="sub-clause">（2）　自らの役員（業務を執行する社員、取締役、執行役またはこれらに準ずる者）が反社会的勢力ではないこと。</div>
    <div class="sub-clause">（3）　反社会的勢力に自己の名義を利用させて本基本契約を締結したものではないこと。</div>
    <div class="sub-clause">（4）　本基本契約の有効期間中、自己または第三者を利用して、相手方に対して暴力的な要求、詐術的な行為、公序良俗に反する行為等を行わないこと。</div>
    <div class="clause clause-content">２　当事者の一方が前項の確約に違反したと判断された場合、相手方は何らの催告を要することなく、本基本契約を直ちに解除することができる。</div>
  </div>

  <div class="article">
    <div class="article-title">第２９条　（損害賠償責任）</div>
    <div class="clause clause-content">　当事者の一方が本基本契約または個別契約に違反し、または不法行為により相手方に損害を与えた場合、違反当事者は、相手方に生じた通常かつ直接の損害に限り、その賠償責任を負う。</div>
    <div class="clause clause-content">２　本条に基づく損害賠償額の上限は、当該損害に係る個別契約に基づき過去12か月間に被許諾者が許諾者に支払った著作権利用料の総額とする。ただし、第１６条（表明および保証）、第１９条（秘密保持）、第２０条（個人情報の保護）、第２８条（反社会的勢力の排除）に違反した場合、または故意若しくは重過失による場合は、この限りでない。</div>
    <div class="clause clause-content">３　本基本契約または個別契約の終了後であっても、終了前に発生した損害賠償請求権の行使を妨げない。</div>
  </div>

  <div class="article">
    <div class="article-title">第３０条　（準拠法・管轄裁判所）</div>
    <div class="clause clause-content">　本基本契約の成立、効力、履行および解釈については、日本国の法令を準拠法とする。</div>
    <div class="clause clause-content">２　本基本契約に関して紛争が生じた場合には、東京地方裁判所を第一審の専属的合意管轄裁判所とする。</div>
  </div>

  <div class="article">
    <div class="article-title">第３１条　（協議）</div>
    <div class="clause clause-content">　本基本契約に定めのない事項または疑義が生じた事項については、許諾者・被許諾者が誠実に協議して解決するものとする。</div>
  </div>

  <div class="article">
    <div class="article-title">第３２条　（通知）</div>
    <div class="clause clause-content">　本基本契約に基づく通知その他の連絡は、当事者が事前に相手方に対して指定した通知先（頭書きに記載の担当者、電話番号および電子メールアドレスを含む。）に対して、書面、電子メールその他当事者間で合意した方法により行うものとする。</div>
    <div class="clause clause-content">２　各当事者は、自らの通知先を変更する場合、相手方に対してその旨を速やかに通知するものとし、当該通知が相手方に到達した時点以降、当該変更は有効となる。</div>
    <div class="clause clause-content">３　ただし、個別契約に本条と異なる定めがある場合は、当該個別契約の定めを優先する。</div>
  </div>

  <div class="margin-note">（以下余白）</div>

  <p class="preamble" style="margin-top:1.5em;">本基本契約の成立を証するため、本書の電磁的記録を作成し、許諾者と被許諾者が合意後、電子署名を施し、各自その電磁的記録を保管する。ただし、書面により締結する場合は本書２通を作成し、記名押印の上各１通を保有する。</p>

</div>
</body>
</html>$html_pub_master_corporate$, $schema_pub_master_corporate$[{"name": "契約番号", "label": "契約番号", "group": "I. ヘッダ", "dbField": "auto.docNumber", "helpText": "生成時に自動採番されます (ARC-PUB-YYYY-NNNN)"}, {"name": "契約締結日", "label": "契約締結日", "group": "I. ヘッダ", "required": true, "placeholder": "例: 2026年5月12日", "helpText": "PDF ヘッダ・署名欄に表示"}, {"name": "許諾者住所", "label": "許諾者 住所", "group": "II. 許諾者 (甲・法人)", "type": "textarea", "required": true, "dbField": "vendor.address"}, {"name": "許諾者法人名", "label": "許諾者 法人名", "group": "II. 許諾者 (甲・法人)", "required": true, "dbField": "vendor.vendor_name"}, {"name": "代表者職名", "label": "代表者 職名", "group": "II. 許諾者 (甲・法人)", "placeholder": "例: 代表取締役"}, {"name": "代表者氏名", "label": "代表者 氏名", "group": "II. 許諾者 (甲・法人)", "required": true, "dbField": "vendor.vendor_rep"}, {"name": "担当者氏名", "label": "担当者 氏名", "group": "II. 許諾者 (甲・法人)", "dbField": "vendor.contact_name"}, {"name": "担当者電話番号", "label": "担当者 電話番号", "group": "II. 許諾者 (甲・法人)", "dbField": "vendor.phone"}, {"name": "担当者メール", "label": "担当者 メール", "group": "II. 許諾者 (甲・法人)", "dbField": "vendor.email"}, {"name": "アークライト住所", "label": "アークライト 住所", "group": "III. アークライト (乙)", "type": "textarea", "required": true, "helpText": "[自社] ボタンで自動入力", "dbField": "company.address"}, {"name": "アークライト代表者氏名", "label": "アークライト 代表者氏名", "group": "III. アークライト (乙)", "required": true, "dbField": "company.rep"}, {"name": "振込先銀行名", "label": "金融機関名", "group": "IV. 振込先口座 (許諾者)", "dbField": "vendor.bank_name"}, {"name": "支店名", "label": "支店名", "group": "IV. 振込先口座 (許諾者)", "dbField": "vendor.branch_name"}, {"name": "口座種別", "label": "口座種別", "group": "IV. 振込先口座 (許諾者)", "type": "select", "options": ["普通", "当座"], "dbField": "vendor.account_type"}, {"name": "口座番号", "label": "口座番号", "group": "IV. 振込先口座 (許諾者)", "dbField": "vendor.account_number"}, {"name": "口座名義カナ", "label": "口座名義 (カナ)", "group": "IV. 振込先口座 (許諾者)", "dbField": "vendor.account_holder_kana"}, {"name": "インボイス登録状況", "label": "適格請求書発行事業者", "group": "V. インボイス制度", "type": "select", "options": ["登録済", "未登録"], "placeholder": "登録済 / 未登録"}, {"name": "インボイス登録番号", "label": "登録番号 (T-)", "group": "V. インボイス制度", "dbField": "vendor.invoice_registration_number"}, {"name": "特記事項", "label": "特記事項", "group": "VI. 特記・発行オプション", "type": "textarea", "helpText": "未入力ならブランク表示"}, {"name": "再発行フラグ", "label": "再発行版バナーを表示", "group": "VI. 特記・発行オプション", "type": "boolean", "helpText": "ON で PDF 冒頭に「再発行版」バナーを表示"}, {"name": "改訂番号", "label": "改訂番号 (Rev.)", "group": "VI. 特記・発行オプション", "placeholder": "1"}, {"name": "元契約番号", "label": "元契約番号", "group": "VI. 特記・発行オプション", "placeholder": "ARC-PUB-2026-0001"}, {"name": "通知先担当者", "type": "text", "label": "通知先 担当者", "group": "VII. 通知先 (許諾者)", "helpText": "本契約上の通知の宛先(許諾者の担当者)"}, {"name": "通知先電話", "type": "text", "label": "通知先 電話", "group": "VII. 通知先 (許諾者)"}, {"name": "通知先メール", "type": "text", "label": "通知先 メール", "group": "VII. 通知先 (許諾者)"}]$schema_pub_master_corporate$::jsonb, '通知先カテゴリ整備+個別契約優先の但し書き (0048)', 'migration-0048'
    FROM t RETURNING id, template_id)
UPDATE document_templates dt SET current_version_id=nv.id, updated_at=now() FROM nv WHERE dt.id=nv.template_id;
