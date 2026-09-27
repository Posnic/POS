# CS-Cart Order and Inventory Boundary

## Scope

This document records the official CS-Cart API capabilities relevant to
future order import and inventory synchronization.

It does not implement a live CS-Cart connector.

## Official documentation

- REST API and authentication:
  https://docs.cs-cart.com/latest/developer_guide/api/index.html

- Orders:
  https://docs.cs-cart.com/latest/developer_guide/api/entities/orders.html

- Products:
  https://docs.cs-cart.com/latest/developer_guide/api/entities/products.html

- Shipments:
  https://docs.cs-cart.com/latest/developer_guide/api/entities/shipments.html

- Event Notifications:
  https://docs.cs-cart.com/latest/developer_guide/core/event_notifications.html

## REST API and authentication

CS-Cart provides a REST API.

The official documentation states that the API:

- uses Basic HTTP authentication;
- uses the administrator email as the login;
- uses an automatically generated API key as the password;
- relies on user-group-defined privileges;
- supports GET, PUT, POST, and DELETE;
- accepts and returns JSON data.

API access must be enabled for the user.

No credentials are included in this repository.

## Order import

The Orders API documents:

- `GET /api/orders/` for listing orders;
- pagination, sorting, and filtering;
- `GET /api/orders/<order_id>/` for an individual order;
- order status;
- ordered products;
- shipping information;
- shipment IDs;
- `PUT /api/orders/<order_id>/` for updating an order.

Therefore, order retrieval is supported by the documented REST API.

This issue does not implement order synchronization.

## Inventory / stock

The Products API documents product retrieval and updates.

The product API supports the `amount` field, which represents product
quantity, and the API supports updating products with `PUT`.

Therefore, product quantity can be read and updated through the documented
product API.

This issue does not implement inventory synchronization or conflict
resolution.

## Shipments

CS-Cart documents a dedicated Shipments REST entity.

The documented shipment fields include:

- `carrier`
- `order_id`
- `products`
- `shipping`
- `shipping_id`
- `tracking_number`
- `status`
- `order_status`

The documented shipment status values are:

- `P` - Picked up
- `A` - Packed
- `S` - Shipped

The documented order status values include:

- `P` - Processed by default
- `C` - Complete
- `O` - Open
- `F` - Failed
- `D` - Declined
- `B` - Backordered
- `I` - Canceled
- `Y` - Awaiting call

Status names and functions can be configured by store owners, so a future
connector should not assume that the letter alone represents a universal
business meaning.

These values are provider-side values. A future Posnic connector would need
an explicit mapping rather than assuming the values are interchangeable with
Posnic states.

## Events and webhook boundary

CS-Cart documents an event notification mechanism.

The official documentation describes events including:

- order creation;
- order status changes;
- shipment creation.

The mechanism contains events, an event dispatcher, messages, transports,
receivers, and notification settings.

The documented transports include email and the Notification Center.

This research therefore confirms a provider-side event/notification
mechanism, but does not establish a generic public outbound webhook API for
third-party connectors.

A future connector must not assume public webhook delivery without additional
provider-specific evidence.

## Order import and stock-update boundary

Based on the documented API:

| Capability | Evidence | Boundary |
|---|---|---|
| Order retrieval | Orders REST API | Supported by documented API |
| Order status retrieval | Order `status` field | Supported |
| Product retrieval | Products REST API | Supported |
| Product quantity retrieval | Product `amount` field | Supported |
| Product quantity update | Product update API | Supported by documented API |
| Shipment retrieval | Shipments REST API | Supported |
| Tracking number | Shipment `tracking_number` | Supported |
| Carrier | Shipment `carrier` | Supported |
| Public outbound webhooks | Not established by reviewed docs | Unverified |
| Automatic synchronization | Not established | Out of scope |
| Conflict resolution | Not established | Out of scope |

## Proposed synthetic fixture

A follow-up fixture should represent one synthetic order with:

1. a synthetic order ID;
2. a synthetic order status;
3. a synthetic product;
4. a synthetic ordered quantity;
5. a synthetic inventory quantity;
6. expected order-import mapping;
7. expected inventory-update mapping.

The fixture must contain no real customer addresses, credentials, merchant
data, or production identifiers.

## Unsupported areas

This issue does not establish or implement:

- a production-ready CS-Cart connector;
- live API credentials;
- automatic synchronization scheduling;
- inventory conflict resolution;
- multi-store synchronization behavior;
- public outbound webhook delivery;
- platform certification;
- shipping-label purchasing.

This document is research only and does not make a certification or
production-integration claim.
