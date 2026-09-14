def invoice_detail(invoice_id, current_user, invoices):
    if current_user is None:
        raise PermissionError("Sign in first")
    return invoices[invoice_id]
