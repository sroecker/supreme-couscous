def authorized_invoice(invoice_id, current_user, invoices):
    if current_user is None:
        raise PermissionError("Sign in first")
    invoice = invoices[invoice_id]
    if invoice["tenant_id"] != current_user["tenant_id"]:
        raise PermissionError("Invoice not available")
    return invoice
