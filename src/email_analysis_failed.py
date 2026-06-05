"""Figma S-14-01/S-14-02/S-14-03 — 분석 실패 메일 HTML (네트워크 / 파일·재업로드 / 지원 요청).

프론트 ``analysis-error-ux.ts`` variant 와 매핑을 맞춘다."""
from __future__ import annotations

import os
from html import escape
from urllib.parse import quote


def default_support_mailbox() -> str:
    """워커 환경: 공개 지원함 우선."""
    raw = (
        os.getenv("NEXT_PUBLIC_SUPPORT_EMAIL", "").strip()
        or os.getenv("ACTNOTE_SUPPORT_EMAIL", "").strip()
    )
    return raw or "ttojo6@gmail.com"


def support_mailto_analysis_failed_href(meeting_title: str) -> str:
    """앱 내 Contact support 버튼과 동일 계열 메일 작성 링크 (mailto)."""
    to = default_support_mailbox()
    subject = "[ACTNOTE] Analysis Failed – Support Request"
    mt = meeting_title.strip() or "(Untitled meeting)"
    body_plain = (
        "\nMeeting Title: "
        + mt
        + "\nError: We couldn't start the analysis due to a server issue.\n\n"
        "Please describe what happened:\n"
        '(e.g. "Upload failed", "Analysis stuck")\n'
    )
    return (
        f"mailto:{quote(to)}?subject={quote(subject)}&body={quote(body_plain)}"
    )


def render_analysis_failed_email(
    *,
    meeting_title: str,
    variant: str,
    view_error_url: str | None,
    support_mailto_href: str | None,
) -> dict[str, str]:
    """``variant``: ``retry_network`` | ``reattach_file`` | ``contact_support``."""

    if variant not in ("retry_network", "reattach_file", "contact_support"):
        raise ValueError(f"unknown analysis failed email variant: {variant}")
    if variant in ("retry_network", "reattach_file"):
        if not (view_error_url or "").strip():
            raise ValueError(
                "view_error_url 가 비었습니다 — 네트워크·파일 실패 메일에는 필수입니다."
            )
    if variant == "contact_support":
        if not (support_mailto_href or "").strip():
            raise ValueError(
                "support_mailto_href 가 비었습니다 — 지원 안내 메일에는 필수입니다."
            )

    safe_title_plain = meeting_title.strip() or "(Untitled meeting)"
    safe_title = escape(safe_title_plain)
    q = "\u201c"
    qq = "\u201d"

    if variant == "retry_network":
        headline = escape("Network Issue")
        bullets_html = (
            f'<li style="margin-bottom:10px;line-height:20px;"><span>Your analysis for '
            f"{q}{safe_title}{qq} was interrupted due to an unstable internet connection.</span></li>"
            '<li style="margin-bottom:0;line-height:20px;"><span>Please check your connection '
            "and try again.</span></li>"
        )
        caption = escape(
            "Clicking the button will take you directly to the specific meeting page "
            "in ACTNOTE to review the error."
        )
        cta_label = "Go to ACTNOTE"
        cta_url = escape((view_error_url or "").strip())
        subject = f"Network issue — \"{safe_title_plain}\""
        text_lines = (
            "Network Issue\n\n"
            f"— \"{safe_title_plain}\"\n\n"
            f"- Your analysis for \"{safe_title_plain}\" was interrupted due to an unstable "
            "internet connection.\n"
            "- Please check your connection and try again.\n\n"
            f"Go to ACTNOTE:\n{view_error_url or ''}\n\n"
        )

    elif variant == "reattach_file":
        headline = escape("File Not Found")
        bullets_html = (
            '<li style="margin-bottom:10px;line-height:20px;"><span>'
            "We couldn&apos;t access the file.<br/>It may have been moved or deleted."
            "</span></li>"
            '<li style="margin-bottom:0;line-height:20px;"><span>'
            "Please create a new meeting and re-upload your file.</span></li>"
        )
        caption = escape(
            "Clicking the button will take you directly to the specific meeting page "
            "in ACTNOTE to review the error."
        )
        cta_label = "Go to ACTNOTE"
        cta_url = escape((view_error_url or "").strip())
        subject = f"File not found — \"{safe_title_plain}\""
        text_lines = (
            "File Not Found\n\n"
            f"— \"{safe_title_plain}\"\n\n"
            "- We couldn't access the file. It may have been moved or deleted.\n"
            "- Please create a new meeting and re-upload your file.\n\n"
            f"Go to ACTNOTE:\n{view_error_url or ''}\n\n"
        )

    elif variant == "contact_support":
        headline = escape("Contact support to continue")
        mailbox = escape(default_support_mailbox())
        support_addr = default_support_mailbox()
        bullets_html = (
            '<li style="margin-bottom:10px;line-height:20px;">'
            "<span>We couldn&apos;t start the analysis due to a server issue.</span>"
            "</li>"
            '<li style="margin-bottom:0;line-height:20px;">'
            '<span style="font-family:Roboto,Helvetica,Arial,sans-serif;">'
            "Contact support at "
            f'<a href="mailto:{escape(support_addr)}" '
            'style="color:#64748b;text-decoration:underline;">'
            f"{mailbox}"
            "</a></span>.</li>"
        )
        caption = escape(
            "Clicking Contact support will open an email to our support team."
        )
        cta_label = "Contact Support"
        href_mail = escape((support_mailto_href or "").strip())
        cta_url = href_mail
        subject = f"Contact support — \"{safe_title_plain}\""
        sm = default_support_mailbox()
        text_lines = (
            "Contact support to continue\n\n"
            f"— \"{safe_title_plain}\"\n\n"
            "- We couldn't start the analysis due to a server issue.\n"
            f"- Contact support at {sm}\n\n"
            "Contact Support (opens mail):\n"
            f"{support_mailto_href or ''}\n\n"
        )

    subtitle_line = (
        '<span style="font-weight:bold;color:#94a3b8;font-size:16px;font-family:'
        'Inter,Roboto,-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;'
        f'line-height:25.6px;">&#8212; {safe_title}</span>'
    )

    footer = (
        '<p style="margin:0 0 8px;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:13px;'
        'font-weight:400;color:#94a3b8;line-height:normal;text-align:center;">'
        "© 2026 ACTNOTE. All rights reserved.</p>"
        '<p style="margin:8px 0 0;line-height:normal;font-size:0;text-align:center;">'
        '<a href="https://actnote.io/terms" target="_blank" rel="noopener noreferrer" '
        'style="color:#64748b;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:13px;'
        'text-decoration:none;">Terms of Service</a>&nbsp;&nbsp;'
        '<a href="https://actnote.io/privacy" target="_blank" rel="noopener noreferrer" '
        'style="color:#64748b;font-family:Roboto,Helvetica,Arial,sans-serif;font-size:13px;'
        'text-decoration:none;">Privacy Policy</a></p>'
    )

    btn_row = ""
    if variant == "contact_support":
        btn_row = (
            '<table role="presentation" cellspacing="0" cellpadding="0" border="0" '
            'align="center" style="margin:0 auto 14px;border-collapse:collapse;">'
            '<tr>'
            '<td align="center" valign="middle" style="border-radius:10px;'
            "background-color:#ff6b35;background-image:"
            'linear-gradient(131deg,#ff6b35 0%,#ff8555 100%);'
            'box-shadow:0 4px 6px rgba(255,107,53,0.35);padding:16px 32px;text-align:center;">'
            f'<a href="{cta_url}" style="display:inline-block;font-family:Roboto,Helvetica,'
            "Arial,sans-serif;font-size:16px;font-weight:700;line-height:normal;"
            'color:#ffffff;text-decoration:none;">'
            + escape(cta_label)
            + "</a>"
            "</td>"
            "</tr>"
            "</table>"
        )
    else:
        btn_row = (
            '<table role="presentation" cellspacing="0" cellpadding="0" border="0" '
            'align="center" style="margin:0 auto 14px;border-collapse:collapse;">'
            '<tr>'
            '<td align="center" valign="middle" style="border-radius:10px;'
            "background-color:#ff6b35;background-image:"
            'linear-gradient(131deg,#ff6b35 0%,#ff8555 100%);'
            'box-shadow:0 4px 6px rgba(255,107,53,0.35);padding:16px 32px;text-align:center;">'
            f'<a href="{cta_url}" target="_blank" rel="noopener noreferrer" '
            'style="display:inline-block;font-family:Roboto,Helvetica,Arial,sans-serif;'
            "font-size:16px;font-weight:700;line-height:normal;color:#ffffff;"
            'text-decoration:none;">'
            + escape(cta_label)
            + "</a>"
            "</td>"
            "</tr>"
            "</table>"
        )

    html = f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
 style="background:#f8fafc;margin:0;padding:0;width:100%;">
  <tr>
    <td align="center" style="padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,\
'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
       style="max-width:600px;width:100%;border-collapse:collapse;background:#ffffff;border-radius:\
12px;overflow:hidden;box-shadow:0 4px 12px rgba(10,37,64,0.08);">
        <tr>
          <td style="padding:40px 52px;background:#0a2540;\
background-image:linear-gradient(150deg,#0a2540 0%,#1e3a5f 100%);">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="center" valign="middle" style="background:#ff6b35;width:32px;\
height:32px;border-radius:6px;line-height:32px;font-size:18px;font-weight:700;color:#1e3a5f;">&#10003;</td>
                <td style="padding-left:12px;font-family:Roboto,Helvetica,Arial,sans-serif;\
font-size:28px;font-weight:700;color:#ffffff;text-transform:uppercase;">ACTNOTE</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
             style="border-collapse:collapse;border:2px solid #e2e8f0;border-radius:12px;">
              <tr>
                <td style="padding:36px 28px 28px;text-align:center;">
                  <p style="margin:0 0 14px;font-family:Roboto,-apple-system,BlinkMacSystemFont,\
'Segoe UI',sans-serif;font-size:24px;font-weight:700;line-height:normal;color:#0a2540;">
                    {headline}</p>
                  <div style="margin:0 0 22px;font-family:Roboto,Helvetica,Arial,sans-serif;\
font-size:16px;line-height:normal;color:#64748b;text-align:center;width:370px;\
max-width:100%;margin-left:auto;margin-right:auto;">{subtitle_line}</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                   style="margin:0 0 22px;border-collapse:collapse;background:#f8fafc;border-radius:8px;">
                    <tr>
                      <td style="padding:24px 22px;text-align:left;">
                        <ul style="margin:8px 0 0;color:#4f6886;\
font-family:Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:400;line-height:20px;\
padding-left:20px;text-align:left;">{bullets_html}</ul>
                      </td>
                    </tr>
                  </table>
                  {btn_row}
                  <p style="margin:10px auto 0;max-width:376px;color:#a1afc1;\
font-family:Roboto,Helvetica,Arial,sans-serif;font-size:12.9px;line-height:20.8px;\
text-align:center;">{caption}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #e2e8f0;padding:24px 40px 22px;text-align:center;">{footer}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>"""

    text_footer = (
        "\n© 2026 ACTNOTE. All rights reserved.\n"
        "Terms of Service: https://actnote.io/terms\n"
        "Privacy Policy: https://actnote.io/privacy\n"
    )

    text = "".join((text_lines, text_footer))

    return {"subject": subject, "html": html, "text": text}


if __name__ == "__main__":
    u = "https://app.actnote.test/meetings/mm/analysis-error?workspace=ww"
    titles: list[str] = []
    for v in ("retry_network", "reattach_file", "contact_support"):
        r = render_analysis_failed_email(
            meeting_title="Product Roadmap Q2 Review",
            variant=v,
            view_error_url=u if v != "contact_support" else None,
            support_mailto_href=(
                support_mailto_analysis_failed_href("Product Roadmap Q2 Review")
                if v == "contact_support"
                else None
            ),
        )
        titles.append(r["subject"])
        assert "</html>" in r["html"] and len(r["text"]) > 50
    print("\n".join(titles))
