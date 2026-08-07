<?php

$states = json_decode(file_get_Contents('states.json'),true);

$new_Array = [];
foreach($states['states'] as $index => $value) {
$country_id = $value['country_id'];
$new_Array[$country_id][] = $value['name'];
}


foreach($new_Array as $index => $value) {

file_put_contents('state_'.$index.'.json', json_encode($value));

}
