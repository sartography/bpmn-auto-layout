import { is } from '../di/DiUtil.js';

export function isSharedGatewayRejectionSink(element) {
  const incoming = element.incoming || [];

  return is(element, 'bpmn:Task')
    && incoming.length > 1
    && incoming.every(flow => is(flow.sourceRef, 'bpmn:ExclusiveGateway'))
    && incoming.every(flow => flow.sourceRef.default !== flow);
}
