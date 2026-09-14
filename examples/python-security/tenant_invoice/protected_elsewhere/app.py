from policy import authorized_invoice


def invoice_detail(invoice_id, current_user, invoices):
    return authorized_invoice(invoice_id, current_user, invoices)
