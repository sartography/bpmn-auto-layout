import { is } from '../di/DiUtil.js';

export const SHARED_GATEWAY_REJECTION_SINK_Y_OFFSET = 30;
export const SHARED_GATEWAY_REJECTION_END_Y_OFFSET = 10;

export function isSharedGatewayRejectionSink(element) {
  const incoming = element.incoming || [];

  return is(element, 'bpmn:Task')
    && incoming.length > 1
    && incoming.every(flow => is(flow.sourceRef, 'bpmn:ExclusiveGateway'))
    && incoming.every(flow => flow.sourceRef.default !== flow);
}
