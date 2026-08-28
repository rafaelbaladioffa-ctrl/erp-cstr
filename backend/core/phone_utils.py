import re


def digits_only(value):
    return re.sub(r"\D", "", value or "")


def phones_match(a, b, *, min_length=8):
    """Compara dois telefones ignorando formatação (+55, parênteses,
    espaços, hífen) e presença/ausência de código de país — considera
    igual se os últimos `min_length` dígitos batem, já que o WhatsApp
    sempre manda o número com código de país e o cadastro nem sempre tem."""
    a_digits, b_digits = digits_only(a), digits_only(b)
    if len(a_digits) < min_length or len(b_digits) < min_length:
        return False
    return a_digits[-min_length:] == b_digits[-min_length:]
