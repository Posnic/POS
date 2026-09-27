# PrestaShop Shipping Fixture Mapping

This fixture is synthetic and documents the intended boundary for PrestaShop
order shipping metadata. It does not implement a live PrestaShop connector.

## Source fields

| PrestaShop source | Fixture field | Posnic mapping |
|---|---|---|
| `orders.current_state` | `current_state` | Determine normalized shipping state |
| `order_states.name` | `current_state.name` | Human-readable source state |
| `order_states.delivery` | `current_state.delivery` | Delivery-state evidence |
| `order_states.shipped` | `current_state.shipped` | Shipped-state evidence |
| `order_states.paid` | `current_state.paid` | Preserve source order-state information |
| `order_states.deleted` | `current_state.deleted` | Preserve source order-state information |
| `orders.id_carrier` | `carrier.id` | Carrier identifier |
| `carriers.name` | `carrier.name` | Carrier name |
| `order_carriers.tracking_number` | `order_carrier.tracking_number` | `tracking_reference` |

## Posnic channel mapping

The fixture represents a PrestaShop order as an ecommerce-origin order.

channel = PRESTASHOP

The channel value is a documented fixture expectation only. It does not
implement live channel registration or connector behavior.

## Normalized fixture expectations

### Supported shipped state

A synthetic shipped-state example is represented as:

shipping_state = SHIPPED
review = false

Carrier identity and tracking reference are preserved.

### Cancelled state

A cancelled order is represented as:

shipping_state = CANCELLED
review = false

No tracking reference is invented when PrestaShop provides an empty tracking
number.

### Unsupported state

A state that the connector cannot map safely must not be silently converted
into a known shipping state.

Instead:

shipping_state = null
review = true
review_reason = UNSUPPORTED_PRESTASHOP_ORDER_STATE

This keeps unsupported provider states visible for manual review.

## Data safety

All order identifiers, carrier identifiers, carrier names, and tracking
references in this fixture are synthetic.

No real customer addresses, credentials, API keys, merchant data, or tracking
numbers are included.

This fixture does not make network requests and does not purchase shipping
labels.
