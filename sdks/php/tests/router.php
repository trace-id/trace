<?php

// Stand-in for the API, used by run.php.
$v = json_decode((string) file_get_contents(__DIR__ . '/../../test-vectors/vectors.json'), true);
header('Content-Type: application/json');
if (($_SERVER['HTTP_AUTHORIZATION'] ?? '') !== 'Bearer sk_test') {
    http_response_code(401);
    echo json_encode(['error' => ['code' => 'unauthorized', 'message' => 'bad key']]);
} elseif ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    $label = basename($_SERVER['REQUEST_URI']);
    $body = json_decode((string) file_get_contents('php://input'), true);
    if ($label === 'full') {
        http_response_code(409);
        echo json_encode(['error' => ['code' => 'limit_reached', 'message' => 'too many types']]);
    } else {
        echo json_encode(['eventId' => explode('/', $_SERVER['REQUEST_URI'])[3], 'label' => $label, 'fraud' => $body['fraud']]);
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'DELETE' && str_ends_with($_SERVER['REQUEST_URI'], '/labels/payment')) {
    http_response_code(204);
} elseif (str_ends_with($_SERVER['REQUEST_URI'], $v['eventId']['valid'])) {
    echo json_encode(json_decode($v['webhook']['body'], true)['data']);
} else {
    http_response_code(404);
    echo json_encode(['error' => ['code' => 'not_found', 'message' => 'Event not found']]);
}
