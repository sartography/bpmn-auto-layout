import {
  isSharedGatewayRejectionSink,
  SHARED_GATEWAY_REJECTION_SINK_Y_OFFSET
} from '../utils/flowNodeUtil.js';

export default {
  'addToGrid': ({ element, grid, visited }) => {
    const nextElements = [];

    const incoming = (element.incoming || [])
      .map(out => out.sourceRef)
      .filter(el => el);

    // adjust the row if it is empty
    if (incoming.length > 1) {
      if (isSharedGatewayRejectionSink(element)) {
        element.layoutOffset = {
          ...(element.layoutOffset || {}),
          y: SHARED_GATEWAY_REJECTION_SINK_Y_OFFSET
        };
        grid.adjustColumnForMultipleIncomingToMedian(incoming, element);
      } else {
        grid.adjustColumnForMultipleIncoming(incoming, element);
      }
      grid.adjustRowForMultipleIncoming(incoming, element);
    }
    return nextElements;
  },
};
