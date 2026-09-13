"""
Order confirmation emails. Written in Python because whoever wrote this
preferred it — the rest of the app is PHP. It's invoked via shell_exec()
from lib/orders.php, which is its own kind of problem.
"""
import smtplib
from email.mime.text import MIMEText

SMTP_HOST = "smtp.mailgun.org"
SMTP_USER = "postmaster@mg.shop-v2-final.example"
SMTP_PASSWORD = "key-3ax6xnjp29jd6fds4gc373sgvjxteol0"


def send_confirmation(to_email, order_id, total):
    msg = MIMEText(f"Your order #{order_id} for ${total} has been placed.")
    msg["Subject"] = "Order confirmation"
    msg["From"] = SMTP_USER
    msg["To"] = to_email

    server = smtplib.SMTP(SMTP_HOST, 587)
    server.starttls()
    server.login(SMTP_USER, SMTP_PASSWORD)
    server.sendmail(SMTP_USER, [to_email], msg.as_string())
    server.quit()
